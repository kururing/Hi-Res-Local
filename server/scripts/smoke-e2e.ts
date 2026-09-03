import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { redactSignedUrl } from '../src/logging/redact.js';
import { createSyntheticWav } from '../src/media/synthetic.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const tsxCli = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const email = `smoke-${suffix}@example.test`;
const password = `Smoke-${suffix}-pass`;
const origin = process.env.SMOKE_ORIGIN ?? 'http://localhost:5173';
const apiBase = (process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const totalTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);
const deadline = Date.now() + totalTimeoutMs;

interface SmokeError extends Error {
  step: string;
  requestId?: string;
}

function fail(step: string, message: string, requestId?: string): never {
  const error = new Error(`${step}: ${message}${requestId ? ` request_id=${requestId}` : ''}`) as SmokeError;
  error.step = step;
  error.requestId = requestId;
  throw error;
}

function remaining(): number {
  return Math.max(1, deadline - Date.now());
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [Redacted]')
    .replace(/https?:\/\/[^\s"]+\?[^\s"]+/g, (url) => redactSignedUrl(url));
}

async function requestJson(
  step: string,
  pathName: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any; headers: Headers; requestId: string }> {
  const requestId = randomUUID();
  const headers = new Headers(init.headers);
  headers.set('x-request-id', requestId);
  if (!headers.has('origin') && (init.method ?? 'GET') !== 'GET') headers.set('origin', origin);
  const response = await fetch(`${apiBase}${pathName}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(remaining()),
  });
  const requestIdOut = response.headers.get('x-request-id') ?? requestId;
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, headers: response.headers, requestId: requestIdOut };
}

async function waitReady(): Promise<void> {
  let last = 'not started';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBase}/health/ready`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await wait(250);
  }
  fail('wait_ready', `API was not ready (${last})`);
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = root,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function runWorkerOnce(): Promise<{ code: number; stdout: string; stderr: string }> {
  const mode = (process.env.SMOKE_WORKER ?? 'local').toLowerCase();
  if (mode === 'none') {
    return Promise.resolve({ code: 0, stdout: 'worker_spawn_skipped', stderr: '' });
  }
  if (mode === 'docker') {
    const composeFile = process.env.SMOKE_COMPOSE_FILE
      ?? path.resolve(root, '../infra/compose.smoke.yml');
    return run('docker', [
      'compose',
      '-f',
      composeFile,
      'run',
      '--rm',
      '--no-deps',
      'worker',
      'node',
      'dist/worker.js',
      '--once',
    ], { ...process.env, MEDIA_PROBE_MODE: 'nnpm' }, path.resolve(root, '..'));
  }
  return run(process.execPath, [
    tsxCli,
    path.join(root, 'src/worker.ts'),
    '--once',
  ], {
    ...process.env,
    MEDIA_PROBE_MODE: 'nnpm',
    NODE_ENV: process.env.NODE_ENV === 'test' ? 'test' : 'development',
  });
}

let lastToken: string | null = null;

const created: {
  userId?: string;
  artistId?: string;
  albumId?: string;
  trackId?: string;
  playlistId?: string;
  objectUrl?: string;
  importTrackId?: string;
} = {};

async function cleanup(token: string | null): Promise<void> {
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  if (created.playlistId && token) {
    await requestJson('cleanup_playlist', `/v1/playlists/${created.playlistId}`, {
      method: 'DELETE',
      headers: auth,
    }).catch(() => undefined);
  }
  if (created.importTrackId && token) {
    await requestJson('cleanup_unpublish_import', `/v1/admin/catalog/tracks/${created.importTrackId}/unpublish`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
    }).catch(() => undefined);
    await requestJson('cleanup_delete_import_track', `/v1/admin/catalog/tracks/${created.importTrackId}`, {
      method: 'DELETE',
      headers: auth,
    }).catch(() => undefined);
  }
  if (created.trackId && token) {
    await requestJson('cleanup_unpublish', `/v1/admin/catalog/tracks/${created.trackId}/unpublish`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
    }).catch(() => undefined);
    await requestJson('cleanup_delete_track', `/v1/admin/catalog/tracks/${created.trackId}`, {
      method: 'DELETE',
      headers: auth,
    }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  let accessToken: string | null = null;
  await waitReady();

  const registered = await requestJson('register', '/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password, display_name: `Smoke ${suffix}` }),
  });
  if (registered.status !== 201) {
    fail('register', `HTTP ${registered.status} ${redact(registered.body)}`, registered.requestId);
  }
  accessToken = registered.body.access_token as string;
  lastToken = accessToken;
  created.userId = registered.body.user.id as string;

  const granted = await run(process.execPath, [
    tsxCli,
    path.join(root, 'scripts/grant-role.ts'),
    '--email',
    email,
    '--role',
    'catalog_admin',
  ], { ...process.env, DATABASE_URL: config.databaseUrl });
  if (granted.code !== 0) {
    fail('grant_admin', redact(granted.stderr || granted.stdout));
  }

  const login = await requestJson('login', '/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200) fail('login', `HTTP ${login.status}`, login.requestId);
  accessToken = login.body.access_token as string;
  lastToken = accessToken;
  const auth = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };

  const caps = await requestJson('capabilities', '/v1/admin/capabilities', { headers: auth });
  if (caps.status !== 200 || caps.body.catalog_admin !== true) {
    fail('capabilities', `admin capability missing ${redact(caps.body)}`, caps.requestId);
  }
  if (caps.headers.get('cache-control') !== 'no-store') {
    fail('capabilities', 'admin response must be Cache-Control: no-store', caps.requestId);
  }

  const artist = await requestJson('create_artist', '/v1/admin/catalog/artists', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: `Smoke Artist ${suffix}` }),
  });
  if (artist.status !== 201) fail('create_artist', `HTTP ${artist.status}`, artist.requestId);
  created.artistId = artist.body.id as string;

  const album = await requestJson('create_album', '/v1/admin/catalog/albums', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      title: `Smoke Album ${suffix}`,
      primary_artist_id: created.artistId,
      year: 2026,
    }),
  });
  if (album.status !== 201) fail('create_album', `HTTP ${album.status}`, album.requestId);
  created.albumId = album.body.id as string;

  const track = await requestJson('create_track', '/v1/admin/catalog/tracks', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      title: `Smoke Track ${suffix}`,
      album_id: created.albumId,
      artist_ids: [created.artistId],
      track_number: 1,
    }),
  });
  if (track.status !== 201) fail('create_track', `HTTP ${track.status}`, track.requestId);
  created.trackId = track.body.id as string;

  const wav = createSyntheticWav();
  const init = await requestJson('init_upload', `/v1/admin/catalog/tracks/${created.trackId}/audio-uploads`, {
    method: 'POST',
    headers: { ...auth, 'idempotency-key': `smoke-upload-${suffix}` },
    body: JSON.stringify({
      filename: 'smoke.wav',
      content_type: 'audio/wav',
      size_bytes: wav.size,
      checksum_sha256: wav.sha256,
    }),
  });
  if (init.status !== 201) fail('init_upload', `HTTP ${init.status} ${redact(init.body)}`, init.requestId);
  if (init.headers.get('cache-control') !== 'no-store') {
    fail('init_upload', 'presign response must be no-store', init.requestId);
  }
  const putUrl = String(init.body.url);
  created.objectUrl = putUrl;
  const putHeaders = new Headers(init.body.headers ?? {});
  const put = await fetch(putUrl, {
    method: 'PUT',
    headers: putHeaders,
    body: new Uint8Array(wav.body),
    credentials: 'omit',
    signal: AbortSignal.timeout(remaining()),
  });
  if (!put.ok) fail('minio_put', `HTTP ${put.status}`);

  const complete = await requestJson('complete_upload', `/v1/admin/uploads/${init.body.upload_id}/complete`, {
    method: 'POST',
    headers: auth,
  });
  if (complete.status !== 200) fail('complete_upload', `HTTP ${complete.status} ${redact(complete.body)}`, complete.requestId);

  const worker = await runWorkerOnce();
  if (worker.code !== 0) {
    fail('worker_once', redact(worker.stderr || worker.stdout));
  }

  let probed: any;
  while (Date.now() < deadline) {
    const status = await requestJson('poll_ingestion', `/v1/admin/uploads/${init.body.upload_id}`, { headers: auth });
    if (status.body.job_status === 'ready') {
      probed = status.body;
      break;
    }
    if (status.body.job_status === 'failed') {
      fail('poll_ingestion', `job failed ${redact(status.body)}`, status.requestId);
    }
    await wait(300);
  }
  if (!probed) fail('poll_ingestion', 'ingestion did not become ready');

  const adminTrack = await requestJson('get_admin_track', `/v1/admin/catalog/tracks/${created.trackId}`, { headers: auth });
  const asset = adminTrack.body.assets?.[0];
  if (!asset) fail('probe_metadata', 'no asset after worker', adminTrack.requestId);
  if (asset.container !== 'wav' || asset.codec !== 'pcm') {
    fail('probe_metadata', `unexpected format ${asset.codec}/${asset.container}`, adminTrack.requestId);
  }
  if (Math.abs(asset.duration_seconds - wav.durationSeconds) > wav.durationToleranceSeconds) {
    fail('probe_metadata', `duration ${asset.duration_seconds}`, adminTrack.requestId);
  }

  const rights = await requestJson('rights', `/v1/admin/catalog/tracks/${created.trackId}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({
      rights_holder: 'Smoke Rights Holder',
      license_source_ref: `smoke-license-${suffix}`,
      territory_scope: 'WW',
      rights_attested: true,
    }),
  });
  if (rights.status !== 200) fail('rights', `HTTP ${rights.status}`, rights.requestId);

  const published = await requestJson('publish', `/v1/admin/catalog/tracks/${created.trackId}/publish`, {
    method: 'POST',
    headers: auth,
  });
  if (published.status !== 200) fail('publish', `HTTP ${published.status} ${redact(published.body)}`, published.requestId);

  const importWav = createSyntheticWav({
    frequencyHz: 523,
    tags: {
      title: `Smoke Import ${suffix}`,
      artist: `Smoke Import Artist ${suffix}`,
      album: `Smoke Import Album ${suffix}`,
      year: '2026',
      genre: 'Electronic',
    },
  });
  const importCreate = await requestJson('import_create', '/v1/admin/imports', {
    method: 'POST',
    headers: { ...auth, 'idempotency-key': `smoke-import-${suffix}` },
    body: JSON.stringify({
      filename: 'smoke-import.wav',
      content_type: 'audio/wav',
      size_bytes: importWav.size,
      checksum_sha256: importWav.sha256,
    }),
  });
  if (importCreate.status !== 201) fail('import_create', `HTTP ${importCreate.status} ${redact(importCreate.body)}`, importCreate.requestId);
  if (importCreate.body.upload?.object_key != null) fail('import_create', 'object_key must be null', importCreate.requestId);
  const importPut = await fetch(String(importCreate.body.upload.url), {
    method: 'PUT',
    headers: new Headers(importCreate.body.upload.headers ?? {}),
    body: new Uint8Array(importWav.body),
    credentials: 'omit',
    signal: AbortSignal.timeout(remaining()),
  });
  if (!importPut.ok) fail('import_minio_put', `HTTP ${importPut.status}`);
  const importComplete = await requestJson('import_complete', `/v1/admin/imports/${importCreate.body.import.id}/complete`, {
    method: 'POST',
    headers: auth,
  });
  if (importComplete.status !== 200) fail('import_complete', `HTTP ${importComplete.status} ${redact(importComplete.body)}`, importComplete.requestId);
  const importWorker = await runWorkerOnce();
  if (importWorker.code !== 0) fail('import_worker_once', redact(importWorker.stderr || importWorker.stdout));
  let importView: any;
  while (Date.now() < deadline) {
    const polled = await requestJson('import_poll', `/v1/admin/imports/${importCreate.body.import.id}`, { headers: auth });
    if (polled.body.status === 'published' || polled.body.status === 'duplicate') {
      importView = polled.body;
      break;
    }
    if (polled.body.status === 'failed') fail('import_poll', `import failed ${redact(polled.body)}`, polled.requestId);
    await wait(300);
  }
  if (!importView) fail('import_poll', 'import did not auto-publish');
  if (importView.status !== 'published' && importView.status !== 'duplicate') {
    fail('import_poll', `expected published ${redact(importView)}`, importView.request_id);
  }
  const importTrackId = importView.committed_track_id as string;
  created.importTrackId = importTrackId;
  const importCatalog = await requestJson('import_catalog', `/v1/catalog/tracks/${importTrackId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (importCatalog.status !== 200) fail('import_catalog', `HTTP ${importCatalog.status}`, importCatalog.requestId);
  if (JSON.stringify(importCatalog.body).includes('storage_key')) fail('import_catalog', 'storage_key leaked');
  const catalogList = await requestJson('catalog_list', '/v1/catalog/tracks', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (catalogList.status !== 200) fail('catalog_list', `HTTP ${catalogList.status}`, catalogList.requestId);
  const catalogIds = Array.isArray(catalogList.body)
    ? catalogList.body.map((item: { id?: string }) => item.id)
    : [];
  if (!catalogIds.includes(importTrackId)) {
    fail('catalog_list', `published import missing from catalog list ${redact(catalogList.body)}`, catalogList.requestId);
  }
  const importStream = await requestJson('import_stream', `/v1/tracks/${importTrackId}/stream`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ quality: 'lossless' }),
  });
  if (importStream.status !== 200) fail('import_stream', `HTTP ${importStream.status}`, importStream.requestId);
  const importRange = await fetch(String(importStream.body.url), {
    headers: { Range: 'bytes=0-1023' },
    credentials: 'omit',
    signal: AbortSignal.timeout(remaining()),
  });
  if (importRange.status !== 206) fail('import_http_range', `expected 206 got ${importRange.status}`);

  const search = await requestJson('catalog_search', `/v1/catalog/search?q=${encodeURIComponent(`Smoke Track ${suffix}`)}&type=track`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (search.status !== 200 || !JSON.stringify(search.body).includes(created.trackId!)) {
    fail('catalog_search', `track not found ${redact(search.body)}`, search.requestId);
  }

  const library = await requestJson('add_library', `/v1/library/tracks/${created.trackId}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (library.status !== 204) fail('add_library', `HTTP ${library.status}`, library.requestId);

  const favorite = await requestJson('favorite', `/v1/favorites/tracks/${created.trackId}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (favorite.status !== 204) fail('favorite', `HTTP ${favorite.status}`, favorite.requestId);

  const playlist = await requestJson('create_playlist', '/v1/playlists', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: `Smoke Playlist ${suffix}`, description: null, is_smart: false, rules_json: null }),
  });
  if (playlist.status !== 200 && playlist.status !== 201) {
    fail('create_playlist', `HTTP ${playlist.status}`, playlist.requestId);
  }
  created.playlistId = playlist.body.id as string;
  const addPl = await requestJson('playlist_add', `/v1/playlists/${created.playlistId}/tracks`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ track_ids: [created.trackId] }),
  });
  if (addPl.status !== 200) fail('playlist_add', `HTTP ${addPl.status}`, addPl.requestId);

  const stream = await requestJson('signed_stream', `/v1/tracks/${created.trackId}/stream`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ quality: 'lossless' }),
  });
  if (stream.status !== 200) fail('signed_stream', `HTTP ${stream.status} ${redact(stream.body)}`, stream.requestId);
  if (stream.headers.get('cache-control') !== 'no-store') {
    fail('signed_stream', 'stream descriptor must be no-store', stream.requestId);
  }
  const signedUrl = String(stream.body.url);
  const range = await fetch(signedUrl, {
    headers: { Range: 'bytes=0-1023' },
    credentials: 'omit',
    signal: AbortSignal.timeout(remaining()),
  });
  if (range.status !== 206) fail('http_range', `expected 206 got ${range.status}`);
  if (!String(range.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes')) {
    fail('http_range', 'missing Accept-Ranges');
  }
  if (!range.headers.get('content-range')?.startsWith('bytes 0-1023/')) {
    fail('http_range', `bad Content-Range ${range.headers.get('content-range')}`);
  }
  const bytes = Buffer.from(await range.arrayBuffer());
  if (bytes.length !== 1024) fail('http_range', `expected 1024 bytes, got ${bytes.length}`);
  const contentType = range.headers.get('content-type') ?? stream.body.asset?.mime_type;
  if (!String(contentType).includes('audio')) fail('http_range', `unexpected content type ${contentType}`);

  const idempotency = `smoke-history-${suffix}`;
  const history1 = await requestJson('history', '/v1/history', {
    method: 'POST',
    headers: { ...auth, 'idempotency-key': idempotency },
    body: JSON.stringify({
      track_id: created.trackId,
      completed_duration_ms: 1500,
      fully_played: false,
    }),
  });
  if (history1.status !== 200) fail('history', `HTTP ${history1.status}`, history1.requestId);
  const history2 = await requestJson('history_retry', '/v1/history', {
    method: 'POST',
    headers: { ...auth, 'idempotency-key': idempotency },
    body: JSON.stringify({
      track_id: created.trackId,
      completed_duration_ms: 1500,
      fully_played: false,
    }),
  });
  if (history2.body.id !== history1.body.id) {
    fail('history_retry', 'idempotent retry created a duplicate', history2.requestId);
  }

  const libTracks = await requestJson('library_state', '/v1/library/tracks', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!JSON.stringify(libTracks.body).includes(created.trackId!)) fail('library_state', 'track missing from library', libTracks.requestId);
  const favState = await requestJson('favorite_state', `/v1/catalog/tracks/${created.trackId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (favState.status !== 200 || favState.body.is_favorite !== true) {
    fail('favorite_state', `expected is_favorite=true ${redact(favState.body)}`, favState.requestId);
  }
  const plState = await requestJson('playlist_state', `/v1/playlists/${created.playlistId}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!JSON.stringify(plState.body).includes(created.trackId!)) fail('playlist_state', 'track missing from playlist', plState.requestId);
  const histState = await requestJson('history_state', '/v1/history', { headers: { authorization: `Bearer ${accessToken}` } });
  const histCount = Array.isArray(histState.body) ? histState.body.filter((row: { track_id: string }) => row.track_id === created.trackId).length : 0;
  if (histCount !== 1) fail('history_state', `expected 1 history row, got ${histCount}`, histState.requestId);

  const unpublished = await requestJson('unpublish', `/v1/admin/catalog/tracks/${created.trackId}/unpublish`, {
    method: 'POST',
    headers: auth,
  });
  if (unpublished.status !== 200) fail('unpublish', `HTTP ${unpublished.status}`, unpublished.requestId);
  const denied = await requestJson('stream_denied', `/v1/tracks/${created.trackId}/stream`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ quality: 'lossless' }),
  });
  if (denied.status === 200) fail('stream_denied', 'unpublished track still streamed', denied.requestId);

  await cleanup(accessToken);
  console.log(JSON.stringify({
    msg: 'smoke_e2e_pass',
    suffix,
    email,
    track_id: created.trackId,
  }));
}

try {
  await main();
} catch (error) {
  const smoke = error as SmokeError;
  console.error(JSON.stringify({
    msg: 'smoke_e2e_fail',
    step: smoke.step ?? 'unknown',
    request_id: smoke.requestId,
    error: redact(smoke.message ?? String(error)),
  }));
  process.exitCode = 1;
} finally {
  await cleanup(lastToken).catch(() => undefined);
}
