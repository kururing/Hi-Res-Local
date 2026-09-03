import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Link2, User } from 'lucide-react';
import { hashFileSha256 } from '../../../admin/checksum';
import { ObjectUploadTransport } from '../../../admin/ObjectUploadTransport';
import { Button } from '../../common/Button';
import { Input } from '../../common/Input';
import { ProgressBar } from '../../common/ProgressBar';
import { useSettings } from '../../../context/SettingsContext';
import { t } from '../../../i18n';
import { usePlatform } from '../../../platform';
import type { AdminAlbum, AdminArtist, UploadStatus } from '../../../platform/admin/types';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif';
const POLL_MS = 400;
const POLL_ATTEMPTS = 40;

type ArtworkPhase = 'idle' | 'hashing' | 'uploading' | 'processing' | 'looking_up' | 'failed';

interface RowState {
  phase: ArtworkPhase;
  percent: number;
  error: string | null;
}

interface AdminArtworkSectionProps {
  transport?: ObjectUploadTransport;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isBusy(phase: ArtworkPhase | undefined): boolean {
  return phase === 'hashing' || phase === 'uploading' || phase === 'processing' || phase === 'looking_up';
}

function hasArtworkUrl(url: string | null | undefined): boolean {
  return Boolean(url?.trim());
}

function phaseLabel(phase: ArtworkPhase, lang: 'vi' | 'en'): string {
  if (phase === 'hashing') return t('admin_status_hashing', lang);
  if (phase === 'uploading') return t('admin_import_status_uploading', lang);
  if (phase === 'processing') return t('admin_artwork_processing', lang);
  if (phase === 'looking_up') return t('admin_artwork_fetching', lang);
  if (phase === 'failed') return t('admin_status_failed', lang);
  return '';
}

async function waitForArtworkJob(
  getUpload: (uploadId: string) => Promise<UploadStatus>,
  uploadId: string,
): Promise<UploadStatus> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const status = await getUpload(uploadId);
    if (status.job_status === 'ready') return status;
    if (status.job_status === 'failed') {
      throw new Error(status.job_error || status.error_message || 'Artwork processing failed.');
    }
    await delay(POLL_MS);
  }
  throw new Error('Artwork processing timed out.');
}

export const AdminArtworkSection: React.FC<AdminArtworkSectionProps> = ({
  transport = new ObjectUploadTransport(),
}) => {
  const { admin } = usePlatform();
  const { settings } = useSettings();
  const lang = settings.language;
  const headingId = useId();
  const liveId = useId();

  const [artists, setArtists] = useState<AdminArtist[]>([]);
  const [albums, setAlbums] = useState<AdminAlbum[]>([]);
  const [artistQuery, setArtistQuery] = useState('');
  const [albumQuery, setAlbumQuery] = useState('');
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(() => new Set());
  const [liveMessage, setLiveMessage] = useState('');
  const [fetchingMissing, setFetchingMissing] = useState(false);
  const artistInputs = useRef(new Map<string, HTMLInputElement>());
  const albumInputs = useRef(new Map<string, HTMLInputElement>());

  const loadArtists = useCallback(async (query?: string) => {
    if (!admin) return;
    setArtists(await admin.listArtists(query));
  }, [admin]);

  const loadAlbums = useCallback(async (query?: string) => {
    if (!admin) return;
    setAlbums(await admin.listAlbums(query));
  }, [admin]);

  useEffect(() => {
    void loadArtists();
    void loadAlbums();
  }, [loadArtists, loadAlbums]);

  const setRow = (key: string, patch: Partial<RowState>) => {
    setRowState(previous => {
      const current = previous[key] ?? { phase: 'idle' as ArtworkPhase, percent: 0, error: null };
      return { ...previous, [key]: { ...current, ...patch } };
    });
  };

  const uploadArtwork = async (
    entityType: 'artist' | 'album',
    entityId: string,
    file: File,
  ) => {
    if (!admin) return;
    const key = `${entityType}:${entityId}`;
    setRow(key, { phase: 'hashing', percent: 0, error: null });
    setLiveMessage(t('admin_status_hashing', lang));
    try {
      const checksum = await hashFileSha256(file);
      setRow(key, { phase: 'uploading', percent: 0 });
      setLiveMessage(t('admin_import_status_uploading', lang));
      const presign = await admin.initArtworkUpload(entityType, entityId, {
        filename: file.name,
        content_type: file.type || 'image/jpeg',
        size_bytes: file.size,
        checksum_sha256: checksum,
      });
      await transport.put({
        upload: presign,
        body: file,
        onProgress: progress => setRow(key, { phase: 'uploading', percent: progress.percent }),
      });
      setRow(key, { phase: 'processing', percent: 100 });
      setLiveMessage(t('admin_artwork_processing', lang));
      await admin.completeUpload(presign.upload_id);
      await waitForArtworkJob(id => admin.getUpload(id), presign.upload_id);
      if (entityType === 'artist') await loadArtists(artistQuery);
      else await loadAlbums(albumQuery);
      setRow(key, { phase: 'idle', percent: 0, error: null });
      setLiveMessage(t('admin_artwork_uploaded', lang));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('admin_error_file', lang);
      setRow(key, { phase: 'failed', percent: 0, error: message });
      setLiveMessage(t('admin_status_failed', lang));
    }
  };

  const markBroken = (url: string) => {
    setBrokenUrls(previous => {
      if (previous.has(url)) return previous;
      const next = new Set(previous);
      next.add(url);
      return next;
    });
  };

  const hasUsableImage = (url: string | null | undefined) => hasArtworkUrl(url) && !brokenUrls.has(url!);

  const onPick = (entityType: 'artist' | 'album', entityId: string, file: File | undefined) => {
    if (!file) return;
    void uploadArtwork(entityType, entityId, file);
  };

  const lookupArtwork = async (entityType: 'artist' | 'album', entityId: string) => {
    if (!admin) return;
    const key = `${entityType}:${entityId}`;
    setRow(key, { phase: 'looking_up', percent: 0, error: null });
    setLiveMessage(t('admin_artwork_fetching', lang));
    try {
      const result = entityType === 'artist'
        ? await admin.lookupArtistArtwork(entityId, { force: true })
        : await admin.lookupAlbumArtwork(entityId, { force: true });
      if (entityType === 'artist') await loadArtists(artistQuery);
      else await loadAlbums(albumQuery);
      setRow(key, {
        phase: 'idle',
        percent: 0,
        error: result.found ? null : t('admin_artwork_fetch_none', lang),
      });
      setLiveMessage(result.found
        ? t('admin_artwork_fetch_done', lang, { count: '1' })
        : t('admin_artwork_fetch_none', lang));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('admin_error_file', lang);
      setRow(key, { phase: 'failed', percent: 0, error: message });
      setLiveMessage(t('admin_status_failed', lang));
    }
  };

  const lookupMissing = async () => {
    if (!admin) return;
    setFetchingMissing(true);
    setLiveMessage(t('admin_artwork_fetching', lang));
    try {
      const result = await admin.lookupMissingArtwork();
      await loadArtists(artistQuery);
      await loadAlbums(albumQuery);
      setLiveMessage(result.filled > 0
        ? t('admin_artwork_fetch_done', lang, { count: String(result.filled) })
        : t('admin_artwork_fetch_none', lang));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('admin_error_file', lang);
      setLiveMessage(message);
    } finally {
      setFetchingMissing(false);
    }
  };

  if (!admin) return null;

  return (
    <section className="flex flex-col gap-5" aria-labelledby={headingId} data-admin-artwork="true">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={headingId} className="text-lg font-medium text-brand-foreground">
            {t('admin_artwork_heading', lang)}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-brand-muted">{t('admin_artwork_help', lang)}</p>
        </div>
        <Button
          type="button"
          size="md"
          disabled={fetchingMissing}
          data-admin-artwork-lookup-missing="true"
          icon={<Link2 className="h-4 w-4" aria-hidden />}
          onClick={() => void lookupMissing()}
        >
          {fetchingMissing ? t('admin_artwork_fetching', lang) : t('admin_artwork_fetch_missing', lang)}
        </Button>
      </header>
      <p id={liveId} className="sr-only" aria-live="polite">{liveMessage}</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-2xl border border-brand-border bg-oled-card p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-brand-muted">
            {t('admin_artwork_artists', lang)}
          </h3>
          <label htmlFor="admin-artwork-artist-search" className="text-sm font-medium text-brand-foreground">
            {t('admin_artwork_search_artists', lang)}
          </label>
          <Input
            id="admin-artwork-artist-search"
            value={artistQuery}
            onChange={event => {
              const value = event.target.value;
              setArtistQuery(value);
              void loadArtists(value);
            }}
            autoComplete="off"
          />
          {artists.length === 0 ? (
            <p className="py-6 text-center text-sm text-brand-muted">{t('admin_artwork_empty_artists', lang)}</p>
          ) : (
            <ul className="flex max-h-[min(28rem,50vh)] flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
              {artists.map(artist => {
                const key = `artist:${artist.id}`;
                const state = rowState[key];
                const busy = isBusy(state?.phase) || fetchingMissing;
                const hasImage = hasUsableImage(artist.image_url);
                return (
                  <li key={artist.id} className="flex items-center gap-3 rounded-xl border border-brand-border/70 bg-oled-base/50 p-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-brand-border bg-oled-card">
                      {hasArtworkUrl(artist.image_url) && !brokenUrls.has(artist.image_url!) ? (
                        <img
                          src={artist.image_url!}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                          onError={() => markBroken(artist.image_url!)}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <User className="h-7 w-7 text-brand-muted" aria-hidden />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-brand-foreground" title={artist.name}>{artist.name}</p>
                      <p className="text-xs text-brand-muted">
                        {hasImage ? t('admin_artwork_uploaded', lang) : t('admin_artwork_no_image', lang)}
                      </p>
                      {state?.phase && state.phase !== 'idle' && state.phase !== 'failed' && (
                        <ProgressBar
                          value={state.percent}
                          label={phaseLabel(state.phase, lang)}
                          statusText={state.phase === 'uploading' ? `${state.percent}%` : phaseLabel(state.phase, lang)}
                        />
                      )}
                      {state?.error && <p className="mt-1 text-xs text-rose-300">{state.error}</p>}
                    </div>
                    <input
                      ref={node => {
                        if (node) artistInputs.current.set(artist.id, node);
                        else artistInputs.current.delete(artist.id);
                      }}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      className="sr-only"
                      aria-label={t('admin_choose_artist_photo', lang, { name: artist.name })}
                      onChange={event => {
                        onPick('artist', artist.id, event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      {!hasImage && (
                        <Button
                          type="button"
                          size="md"
                          disabled={busy}
                          data-admin-artwork-fetch="artist"
                          aria-label={t('admin_artwork_fetch_artist', lang, { name: artist.name })}
                          icon={<Link2 className="h-4 w-4" aria-hidden />}
                          onClick={() => void lookupArtwork('artist', artist.id)}
                        >
                          {t('admin_artwork_fetch', lang)}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="md"
                        disabled={busy}
                        aria-label={t('admin_choose_artist_photo', lang, { name: artist.name })}
                        icon={<ImagePlus className="h-4 w-4" aria-hidden />}
                        onClick={() => artistInputs.current.get(artist.id)?.click()}
                      >
                        {t('admin_choose_artwork', lang)}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-brand-border bg-oled-card p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-brand-muted">
            {t('admin_artwork_albums', lang)}
          </h3>
          <label htmlFor="admin-artwork-album-search" className="text-sm font-medium text-brand-foreground">
            {t('admin_artwork_search_albums', lang)}
          </label>
          <Input
            id="admin-artwork-album-search"
            value={albumQuery}
            onChange={event => {
              const value = event.target.value;
              setAlbumQuery(value);
              void loadAlbums(value);
            }}
            autoComplete="off"
          />
          {albums.length === 0 ? (
            <p className="py-6 text-center text-sm text-brand-muted">{t('admin_artwork_empty_albums', lang)}</p>
          ) : (
            <ul className="flex max-h-[min(28rem,50vh)] flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
              {albums.map(album => {
                const key = `album:${album.id}`;
                const state = rowState[key];
                const busy = isBusy(state?.phase) || fetchingMissing;
                const hasCover = hasUsableImage(album.cover_url);
                return (
                  <li key={album.id} className="flex items-center gap-3 rounded-xl border border-brand-border/70 bg-oled-base/50 p-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-brand-border bg-oled-card">
                      {hasArtworkUrl(album.cover_url) && !brokenUrls.has(album.cover_url!) ? (
                        <img
                          src={album.cover_url!}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                          onError={() => markBroken(album.cover_url!)}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-brand-muted">
                          {t('admin_artwork_placeholder', lang)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-brand-foreground" title={album.title}>{album.title}</p>
                      {album.artist_name ? (
                        <p className="truncate text-xs text-brand-muted">{album.artist_name}</p>
                      ) : null}
                      <p className="text-xs text-brand-muted">
                        {hasCover ? t('admin_artwork_uploaded', lang) : t('admin_artwork_no_image', lang)}
                      </p>
                      {state?.phase && state.phase !== 'idle' && state.phase !== 'failed' && (
                        <ProgressBar
                          value={state.percent}
                          label={phaseLabel(state.phase, lang)}
                          statusText={state.phase === 'uploading' ? `${state.percent}%` : phaseLabel(state.phase, lang)}
                        />
                      )}
                      {state?.error && <p className="mt-1 text-xs text-rose-300">{state.error}</p>}
                    </div>
                    <input
                      ref={node => {
                        if (node) albumInputs.current.set(album.id, node);
                        else albumInputs.current.delete(album.id);
                      }}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      className="sr-only"
                      aria-label={t('admin_choose_album_cover', lang, { name: album.title })}
                      onChange={event => {
                        onPick('album', album.id, event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      {!hasCover && (
                        <Button
                          type="button"
                          size="md"
                          disabled={busy}
                          data-admin-artwork-fetch="album"
                          aria-label={t('admin_artwork_fetch_album', lang, { name: album.title })}
                          icon={<Link2 className="h-4 w-4" aria-hidden />}
                          onClick={() => void lookupArtwork('album', album.id)}
                        >
                          {t('admin_artwork_fetch', lang)}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="md"
                        disabled={busy}
                        aria-label={t('admin_choose_album_cover', lang, { name: album.title })}
                        icon={<ImagePlus className="h-4 w-4" aria-hidden />}
                        onClick={() => albumInputs.current.get(album.id)?.click()}
                      >
                        {t('admin_choose_artwork', lang)}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};
