import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';

export interface UserPreferencesRow {
  user_id: string;
  schema_version: number;
  preferences_json: Record<string, unknown>;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PreferencesRepository {
  constructor(private readonly db: Queryable) {}

  async get(userId: string): Promise<UserPreferencesRow | null> {
    const result = await query<UserPreferencesRow>(
      this.db,
      `SELECT user_id, schema_version, preferences_json, revision, created_at, updated_at
       FROM user_preferences WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async upsert(
    userId: string,
    schemaVersion: number,
    preferences: Record<string, unknown>,
    expectedRevision: number | null,
  ): Promise<UserPreferencesRow | null> {
    if (expectedRevision == null) {
      const result = await query<UserPreferencesRow>(this.db, `
        INSERT INTO user_preferences (user_id, schema_version, preferences_json, revision)
        VALUES ($1, $2, $3::jsonb, 1)
        ON CONFLICT (user_id) DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          preferences_json = EXCLUDED.preferences_json,
          revision = user_preferences.revision + 1,
          updated_at = timezone('utc', now())
        RETURNING user_id, schema_version, preferences_json, revision, created_at, updated_at
      `, [userId, schemaVersion, JSON.stringify(preferences)]);
      return result.rows[0] ?? null;
    }

    const result = await query<UserPreferencesRow>(this.db, `
      UPDATE user_preferences
      SET schema_version = $3,
          preferences_json = $4::jsonb,
          revision = revision + 1,
          updated_at = timezone('utc', now())
      WHERE user_id = $1 AND revision = $2
      RETURNING user_id, schema_version, preferences_json, revision, created_at, updated_at
    `, [userId, expectedRevision, schemaVersion, JSON.stringify(preferences)]);
    return result.rows[0] ?? null;
  }
}
