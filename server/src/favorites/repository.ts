import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';

export class FavoritesRepository {
  constructor(private readonly db: Queryable) {}

  async addTrack(userId: string, trackId: string): Promise<void> {
    await query(this.db, `
      INSERT INTO user_favorite_tracks (user_id, track_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, track_id) DO NOTHING
    `, [userId, trackId]);
  }

  async removeTrack(userId: string, trackId: string): Promise<void> {
    await query(this.db, `
      DELETE FROM user_favorite_tracks
      WHERE user_id = $1 AND track_id = $2
    `, [userId, trackId]);
  }

  async addAlbum(userId: string, albumId: string): Promise<void> {
    await query(this.db, `
      INSERT INTO user_favorite_albums (user_id, album_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, album_id) DO NOTHING
    `, [userId, albumId]);
  }

  async removeAlbum(userId: string, albumId: string): Promise<void> {
    await query(this.db, `
      DELETE FROM user_favorite_albums
      WHERE user_id = $1 AND album_id = $2
    `, [userId, albumId]);
  }

  async addArtist(userId: string, artistId: string): Promise<void> {
    await query(this.db, `
      INSERT INTO user_favorite_artists (user_id, artist_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, artist_id) DO NOTHING
    `, [userId, artistId]);
  }

  async removeArtist(userId: string, artistId: string): Promise<void> {
    await query(this.db, `
      DELETE FROM user_favorite_artists
      WHERE user_id = $1 AND artist_id = $2
    `, [userId, artistId]);
  }

  async listAlbums(userId: string): Promise<Array<{ album_title: string; artist_name: string }>> {
    const result = await query<{ album_title: string; artist_name: string }>(this.db, `
      SELECT al.title AS album_title, ar.name AS artist_name
      FROM user_favorite_albums ufa
      JOIN albums al ON al.id = ufa.album_id
      JOIN artists ar ON ar.id = al.primary_artist_id
      WHERE ufa.user_id = $1
      ORDER BY lower(ar.name), lower(al.title), al.id
    `, [userId]);
    return result.rows;
  }

  async listArtists(userId: string): Promise<string[]> {
    const result = await query<{ name: string }>(this.db, `
      SELECT ar.name
      FROM user_favorite_artists ufa
      JOIN artists ar ON ar.id = ufa.artist_id
      WHERE ufa.user_id = $1
      ORDER BY lower(ar.name), ar.id
    `, [userId]);
    return result.rows.map((row) => row.name);
  }
}
