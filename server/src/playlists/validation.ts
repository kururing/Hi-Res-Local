import { AppError, ErrorCodes } from '../errors/appError.js';

const LOCAL_UNIX_PREFIXES = [
  '/Users/',
  '/home/',
  '/Volumes/',
  '/mnt/',
  '/media/',
  '/opt/',
  '/var/',
  '/tmp/',
  '/private/',
] as const;

export const PLAYLIST_NAME_MAX = 200;
export const PLAYLIST_DESCRIPTION_MAX = 2000;
export const PLAYLIST_RULES_MAX = 8000;
export const PLAYLIST_COVER_MAX = 2048;

export function isLocalFilePath(value: string): boolean {
  const path = value.trim();
  if (!path) return false;
  if (path.startsWith('file:')) return true;
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  if (path.startsWith('\\\\')) return true;
  return LOCAL_UNIX_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function validatePlaylistName(raw: string): string {
  const name = raw.trim();
  if (!name) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Playlist name is required.');
  }
  if (name.length > PLAYLIST_NAME_MAX) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `Playlist name must be at most ${PLAYLIST_NAME_MAX} characters.`);
  }
  return name;
}

export function validatePlaylistDescription(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const description = raw.trim();
  if (!description) return null;
  if (description.length > PLAYLIST_DESCRIPTION_MAX) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `Description must be at most ${PLAYLIST_DESCRIPTION_MAX} characters.`);
  }
  return description;
}

export function validateRulesJson(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    if (raw.length > PLAYLIST_RULES_MAX) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `rules_json must be at most ${PLAYLIST_RULES_MAX} characters.`);
    }
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      JSON.parse(trimmed);
    } catch {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'rules_json must be valid JSON.');
    }
    return raw;
  }
  if (typeof raw === 'object') {
    let encoded: string;
    try {
      encoded = JSON.stringify(raw);
    } catch {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'rules_json must be valid JSON.');
    }
    if (encoded.length > PLAYLIST_RULES_MAX) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `rules_json must be at most ${PLAYLIST_RULES_MAX} characters.`);
    }
    return encoded;
  }
  throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'rules_json must be valid JSON.');
}

export function validateCoverArtPath(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.length > PLAYLIST_COVER_MAX) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'cover_art_path is too long.');
  }
  if (value.startsWith('data:')) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'cover_art_path cannot be a data URL.');
  }
  if (isLocalFilePath(value)) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'cover_art_path cannot be a local filesystem path.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'cover_art_path must be an http(s) URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'cover_art_path must be an http(s) URL.');
  }
  return value;
}
