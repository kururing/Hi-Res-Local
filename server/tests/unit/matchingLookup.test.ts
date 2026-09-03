import { describe, expect, it } from 'vitest';
import type { Queryable } from '../../src/db/types.js';
import { matchAlbum, matchArtist, matchTrack } from '../../src/admin/matching.js';

function sqlDb(handler: (text: string, params: unknown[]) => unknown[]): Queryable {
  return {
    async query(text: string, params?: unknown[]) {
      const rows = handler(text, params ?? []);
      return { rowCount: rows.length, rows, command: 'SELECT', oid: 0, fields: [] };
    },
  } as Queryable;
}

describe('automatic catalog matching', () => {
  it('matches artist by MusicBrainz id before exact name', async () => {
    const db = sqlDb((text) => {
      if (text.includes('musicbrainz_artist_id')) return [{ id: 'mb-artist', name: 'Tagged' }];
      return [{ id: 'name-artist', name: 'Tagged' }];
    });
    const result = await matchArtist(db, { musicbrainzArtistId: 'mbid-1', name: 'Tagged' });
    expect(result.status).toBe('exact');
    expect(result.candidates[0]?.id).toBe('mb-artist');
  });

  it('matches artist by normalized name when no MusicBrainz id exists', async () => {
    const db = sqlDb((text, params) => {
      if (text.includes('musicbrainz_artist_id')) return [];
      expect(params[0]).toBe('charlie puth');
      return [{ id: 'a1', name: 'Charlie Puth' }];
    });
    const result = await matchArtist(db, { musicbrainzArtistId: null, name: 'Charlie Puth' });
    expect(result.candidates[0]?.id).toBe('a1');
  });

  it('matches album by MusicBrainz id, then UPC, then title plus artist', async () => {
    const byMb = await matchAlbum(sqlDb((text) => {
      if (text.includes('al.musicbrainz_album_id')) return [{ id: 'al-mb', title: 'DRIP', artist_name: 'BABYMONSTER', primary_artist_id: 'ar1' }];
      return [];
    }), {
      musicbrainzAlbumId: 'mb-album',
      upc: '8809519880477',
      title: 'DRIP',
      artistName: 'BABYMONSTER',
      artistId: 'ar1',
      year: 2024,
    });
    expect(byMb.candidates[0]?.id).toBe('al-mb');

    const byUpc = await matchAlbum(sqlDb((text) => {
      if (text.includes('al.upc')) return [{ id: 'al-upc', title: 'DRIP', artist_name: 'BABYMONSTER', primary_artist_id: 'ar1' }];
      return [];
    }), {
      musicbrainzAlbumId: null,
      upc: '8809519880477',
      title: 'DRIP',
      artistName: 'BABYMONSTER',
      artistId: 'ar1',
      year: 2024,
    });
    expect(byUpc.candidates[0]?.id).toBe('al-upc');
  });

  it('matches track by ISRC, then MusicBrainz track id', async () => {
    const byIsrc = await matchTrack(sqlDb((text) => {
      if (text.includes('WHERE isrc')) return [{ id: 't-isrc', title: 'How Long', album_id: 'al1' }];
      return [];
    }), {
      isrc: 'USAT21702278',
      musicbrainzTrackId: 'mb-track',
      artistId: 'ar1',
      albumId: 'al1',
      disc: 1,
      track: 1,
      title: 'How Long',
      checksum: 'aa'.repeat(32),
    });
    expect(byIsrc.candidates[0]?.id).toBe('t-isrc');

    const byMb = await matchTrack(sqlDb((text) => {
      if (text.includes('musicbrainz_track_id')) return [{ id: 't-mb', title: 'How Long', album_id: 'al1' }];
      return [];
    }), {
      isrc: null,
      musicbrainzTrackId: 'mb-track',
      artistId: 'ar1',
      albumId: 'al1',
      disc: 1,
      track: 1,
      title: 'How Long',
      checksum: 'aa'.repeat(32),
    });
    expect(byMb.candidates[0]?.id).toBe('t-mb');
  });

  it('falls back to checksum when title fingerprint is absent', async () => {
    const result = await matchTrack(sqlDb((text) => {
      if (text.includes('aa.checksum')) return [{ id: 't-sum', title: 'How Long', album_id: 'al1' }];
      return [];
    }), {
      isrc: null,
      musicbrainzTrackId: null,
      artistId: null,
      albumId: null,
      disc: null,
      track: null,
      title: 'How Long',
      checksum: 'ab'.repeat(32),
    });
    expect(result.candidates[0]?.id).toBe('t-sum');
  });
});
