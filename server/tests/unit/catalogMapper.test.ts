import { describe, expect, it } from 'vitest';
import { toFrontendTrack } from '../../src/catalog/mapper.js';
import { normalizeCatalogName } from '../../src/catalog/normalize.js';

const baseInput = {
  id: '33333333-3333-4333-8333-333333333331',
  title: 'Lanterns Over Water',
  albumTitle: 'Glass Harbor',
  durationSeconds: 214.5,
  trackNumber: 1,
  discNumber: 1,
  year: 2024,
  genre: 'Electronic',
  dateAdded: new Date('2026-08-29T00:00:00.000Z'),
  coverArtUrl: 'https://cdn.example.test/covers/glass-harbor.jpg',
  artists: [{ name: 'Aurora Circuit' }],
  displayAsset: {
    container: 'flac',
    codec: 'flac',
    sampleRateHz: 96_000,
    bitDepth: 24,
    channels: 2,
    bitrateKbps: 3200,
  },
};

describe('toFrontendTrack', () => {
  it('matches the web Track contract and never emits a local path or storage key', () => {
    const track = toFrontendTrack(baseInput);

    expect(track).toMatchObject({
      id: '33333333-3333-4333-8333-333333333331',
      title: 'Lanterns Over Water',
      artist: 'Aurora Circuit',
      album: 'Glass Harbor',
      duration: 214.5,
      duration_ms: 214500,
      path: '',
      track_number: 1,
      sample_rate: 96_000,
      bitrate: 3200,
      channels: 2,
      bit_depth: 24,
      bits_per_sample: 24,
      format: 'FLAC',
      cover_art_path: 'https://cdn.example.test/covers/glass-harbor.jpg',
      artist_image_url: null,
      is_favorite: false,
      play_count: 0,
      last_played: null,
      last_played_at: null,
      lyrics: null,
      isrc: null,
      musicbrainz_track_id: null,
      checksum_sha256: null,
    });
    expect(JSON.stringify(track)).not.toContain('storage');
    expect(track.path).toBe('');
  });

  it('copies the first artist portrait onto the track', () => {
    const track = toFrontendTrack({
      ...baseInput,
      artists: [
        { name: 'Aurora Circuit', image_url: 'https://cdn.example.test/artists/aurora.jpg' },
        { name: 'Guest', image_url: 'https://cdn.example.test/artists/guest.jpg' },
      ],
    });
    expect(track.artist_image_url).toBe('https://cdn.example.test/artists/aurora.jpg');
  });

  it('applies user presentation state without hardcoding favorites', () => {
    const track = toFrontendTrack({
      ...baseInput,
      userState: {
        isFavorite: true,
        playCount: 4,
        lastPlayedAt: '2026-08-29T12:00:00.000Z',
      },
    });
    expect(track.is_favorite).toBe(true);
    expect(track.play_count).toBe(4);
    expect(track.last_played).toBe('2026-08-29T12:00:00.000Z');
    expect(track.last_played_at).toBe('2026-08-29T12:00:00.000Z');
  });
});

describe('normalizeCatalogName', () => {
  it('trims, collapses whitespace, and lowercases', () => {
    expect(normalizeCatalogName('  Aurora   Circuit ')).toBe('aurora circuit');
  });
});
