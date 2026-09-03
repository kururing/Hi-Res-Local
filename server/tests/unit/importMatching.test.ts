import { describe, expect, it } from 'vitest';
import { importIsReady, mergeImportMetadata, type ImportDetectedMetadata } from '../../src/admin/importMetadata.js';
import { emptyDetected } from '../../src/admin/importMetadata.js';
import { matchNeedsReview, type ImportMatchResult } from '../../src/admin/matching.js';
import { UNKNOWN_ALBUM_TITLE, UNKNOWN_ARTIST_NAME } from '../../src/admin/placeholders.js';

const detected: ImportDetectedMetadata = {
  ...emptyDetected(),
  title: 'Lanterns',
  artist: 'Aurora Circuit',
  album_artist: 'Aurora Circuit',
  album: 'Glass Harbor',
  genre: 'Electronic',
  year: 2024,
  date: '2024',
  track: 1,
  track_total: 8,
  disc: 1,
  disc_total: 1,
  duration_seconds: 180,
  container: 'flac',
  codec: 'flac',
  bitrate_kbps: 900,
  sample_rate_hz: 44_100,
  bit_depth: 16,
  channels: 2,
  channel_layout: 'stereo',
  lossless: true,
  title_source: 'tag',
};

const exact: ImportMatchResult = {
  artist: { status: 'exact', candidates: [{ id: 'a1', name: 'Aurora Circuit' }] },
  album: { status: 'exact', candidates: [{ id: 'b1', title: 'Glass Harbor', artist_name: 'Aurora Circuit', primary_artist_id: 'a1' }] },
};

describe('import matching readiness', () => {
  it('does not require an admin choice when artist matching would have been ambiguous', () => {
    const match: ImportMatchResult = {
      artist: { status: 'ambiguous', candidates: [{ id: 'a1', name: 'A' }, { id: 'a2', name: 'A' }] },
      album: { status: 'none', candidates: [] },
    };
    expect(matchNeedsReview(match, null, null)).toBe(false);
    expect(importIsReady(mergeImportMetadata(detected, {}))).toBe(true);
  });

  it('is ready when title, artist, and album are present after fallback', () => {
    expect(importIsReady(mergeImportMetadata(detected, {}))).toBe(true);
  });

  it('is ready with shared unknown artist/album names', () => {
    expect(importIsReady(mergeImportMetadata({
      ...detected,
      artist: UNKNOWN_ARTIST_NAME,
      album: UNKNOWN_ALBUM_TITLE,
      album_artist: UNKNOWN_ARTIST_NAME,
    }, {}))).toBe(true);
  });

  it('is not ready when title is missing', () => {
    expect(importIsReady(mergeImportMetadata({ ...detected, title: null }, {}))).toBe(false);
  });
});
