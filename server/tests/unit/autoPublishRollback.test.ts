import { describe, expect, it } from 'vitest';
import type { Queryable } from '../../src/db/types.js';
import { autoPublishImport } from '../../src/admin/autoPublish.js';
import { emptyDetected } from '../../src/admin/importMetadata.js';
import type { AudioImportRow } from '../../src/admin/importRepository.js';

describe('auto-publish transaction control flow', () => {
  it('rolls back catalog writes when a later step fails', async () => {
    let artistInserted = false;
    const db = {
      async query(text: string) {
        if (text.includes('FROM audio_assets') && text.includes('checksum')) {
          return { rowCount: 0, rows: [], command: 'SELECT', oid: 0, fields: [] };
        }
        if (text.includes('placeholder_kind') && text.includes('FROM artists')) {
          return { rowCount: 0, rows: [], command: 'SELECT', oid: 0, fields: [] };
        }
        if (text.includes('INSERT INTO artists')) {
          artistInserted = true;
          return {
            rowCount: 1,
            rows: [{
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Rollback Artist',
              sort_name: 'rollback artist',
              created_at: new Date(),
              updated_at: new Date(),
            }],
            command: 'INSERT',
            oid: 0,
            fields: [],
          };
        }
        if (text.includes('INSERT INTO albums')) {
          throw new Error('album insert failed');
        }
        if (text.includes('SELECT') && text.includes('FROM artists')) {
          return { rowCount: 0, rows: [], command: 'SELECT', oid: 0, fields: [] };
        }
        if (text.includes('FROM albums')) {
          return { rowCount: 0, rows: [], command: 'SELECT', oid: 0, fields: [] };
        }
        if (text.includes('UPDATE audio_imports')) {
          return { rowCount: 1, rows: [], command: 'UPDATE', oid: 0, fields: [] };
        }
        return { rowCount: 0, rows: [], command: 'SELECT', oid: 0, fields: [] };
      },
    } as Queryable;

    const row = {
      id: '22222222-2222-4222-8222-222222222222',
      owner_id: '33333333-3333-4333-8333-333333333333',
      upload_id: '44444444-4444-4444-8444-444444444444',
      original_filename: 'track.flac',
      expected_mime: 'audio/flac',
      expected_size_bytes: 12,
      expected_checksum_sha256: 'aa'.repeat(32),
      bucket: 'audio',
      object_key: 'ingestion/audio/x.flac',
      status: 'probing',
      detected_metadata_json: {},
      override_metadata_json: {},
      match_json: {},
      committed_track_id: null,
      committed_album_id: null,
      committed_artist_id: null,
      error_code: null,
      error_message: null,
      idempotency_key: null,
      expires_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    } as AudioImportRow;

    await expect(autoPublishImport(db, {
      row,
      detected: {
        ...emptyDetected(),
        title: 'Rollback Track',
        artist: 'Rollback Artist',
        album: 'Rollback Album',
        album_artist: 'Rollback Artist',
        duration_seconds: 3,
      },
      adminId: row.owner_id,
      requestId: 'req',
      checksum: row.expected_checksum_sha256,
    })).rejects.toThrow('album insert failed');
    expect(artistInserted).toBe(true);
  });

  it('reuses an existing published track when the checksum already exists', async () => {
    const trackId = '55555555-5555-4555-8555-555555555555';
    const db = {
      async query(text: string) {
        if (text.includes('FROM audio_assets') && text.includes('checksum')) {
          return {
            rowCount: 1,
            rows: [{
              id: '66666666-6666-4666-8666-666666666666',
              track_id: trackId,
              storage_key: 'ingestion/audio/old.flac',
              container: 'flac',
              codec: 'flac',
              mime_type: 'audio/flac',
              sample_rate_hz: 44_100,
              bit_depth: 16,
              channels: 2,
              bitrate_kbps: 900,
              duration_seconds: 3,
              file_size_bytes: 12,
              checksum: 'aa'.repeat(32),
              is_lossless: true,
              available: true,
              validation_state: 'ready',
              source_upload_id: null,
            }],
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (text.includes('FROM tracks t')) {
          return {
            rowCount: 1,
            rows: [{
              id: trackId,
              title: 'Existing',
              album_id: '77777777-7777-4777-8777-777777777777',
              album_title: 'Existing Album',
              track_number: 1,
              disc_number: 1,
              duration_seconds: 3,
              genre: null,
              available: true,
              publication_state: 'published',
              deleted_at: null,
              created_at: new Date(),
              updated_at: new Date(),
            }],
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }
        if (text.includes('UPDATE audio_imports')) {
          return { rowCount: 1, rows: [], command: 'UPDATE', oid: 0, fields: [] };
        }
        if (text.includes('INSERT INTO admin_audit_log')) {
          return { rowCount: 1, rows: [], command: 'INSERT', oid: 0, fields: [] };
        }
        return { rowCount: 0, rows: [], command: 'SELECT', oid: 0, fields: [] };
      },
    } as Queryable;

    const row = {
      id: '22222222-2222-4222-8222-222222222222',
      owner_id: '33333333-3333-4333-8333-333333333333',
      upload_id: '44444444-4444-4444-8444-444444444444',
      original_filename: 'track.flac',
      expected_mime: 'audio/flac',
      expected_size_bytes: 12,
      expected_checksum_sha256: 'aa'.repeat(32),
      bucket: 'audio',
      object_key: 'ingestion/audio/x.flac',
      status: 'probing',
      detected_metadata_json: {},
      override_metadata_json: {},
      match_json: {},
      committed_track_id: null,
      committed_album_id: null,
      committed_artist_id: null,
      error_code: null,
      error_message: null,
      idempotency_key: null,
      expires_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    } as AudioImportRow;

    const result = await autoPublishImport(db, {
      row,
      detected: {
        ...emptyDetected(),
        title: 'Existing',
        artist: 'Artist',
        album: 'Album',
        duration_seconds: 3,
      },
      adminId: row.owner_id,
      requestId: 'req',
      checksum: row.expected_checksum_sha256,
    });
    expect(result.status).toBe('duplicate');
    expect(result.trackId).toBe(trackId);
    expect(result.created.track).toBe(false);
  });
});
