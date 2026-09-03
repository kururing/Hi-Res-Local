import { AppError, ErrorCodes } from '../errors/appError.js';
import { PREFERENCES_SCHEMA_VERSION, sanitizePreferences } from './allowlist.js';
import { PreferencesRepository, type UserPreferencesRow } from './repository.js';
import type { Pool } from 'pg';

export interface PreferencesView {
  schema_version: number;
  revision: number;
  preferences: Record<string, unknown>;
  updated_at: string;
}

function toView(row: UserPreferencesRow | null): PreferencesView {
  if (!row) {
    return {
      schema_version: PREFERENCES_SCHEMA_VERSION,
      revision: 0,
      preferences: {},
      updated_at: new Date(0).toISOString(),
    };
  }
  const json = row.preferences_json && typeof row.preferences_json === 'object'
    ? row.preferences_json
    : {};
  return {
    schema_version: Number(row.schema_version),
    revision: Number(row.revision),
    preferences: sanitizePreferences(json),
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString(),
  };
}

export class PreferencesService {
  constructor(private readonly repo: PreferencesRepository) {}

  static fromPool(pool: Pool): PreferencesService {
    return new PreferencesService(new PreferencesRepository(pool));
  }

  async get(userId: string): Promise<PreferencesView> {
    return toView(await this.repo.get(userId));
  }

  async put(
    userId: string,
    input: { revision?: number | null; preferences: unknown },
  ): Promise<PreferencesView> {
    const preferences = sanitizePreferences(input.preferences);
    const expected = input.revision == null ? null : input.revision;
    if (expected != null && (!Number.isInteger(expected) || expected < 0)) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'revision must be a non-negative integer.');
    }

    const current = await this.repo.get(userId);
    if (expected != null && expected > 0) {
      if (!current || Number(current.revision) !== expected) {
        throw new AppError(
          409,
          ErrorCodes.PREFERENCES_CONFLICT,
          'Preferences were updated from another client.',
        );
      }
    }

    const saved = await this.repo.upsert(
      userId,
      PREFERENCES_SCHEMA_VERSION,
      preferences,
      expected != null && expected > 0 ? expected : null,
    );
    if (!saved) {
      throw new AppError(
        409,
        ErrorCodes.PREFERENCES_CONFLICT,
        'Preferences were updated from another client.',
      );
    }
    return toView(saved);
  }
}
