import { AppError, ErrorCodes } from '../errors/appError.js';
import { normalizeCatalogName } from '../catalog/normalize.js';

export const NAME_MAX = 200;
export const TITLE_MAX = 300;
export const GENRE_MAX = 40;
export const TRACK_NUMBER_MAX = 999;
export const YEAR_MIN = 1000;
export const YEAR_MAX = 9999;

export const ALLOWED_GENRES = new Set([
  'electronic',
  'ambient',
  'modern classical',
  'classical',
  'jazz',
  'rock',
  'pop',
  'folk',
  'hip-hop',
  'soundtrack',
  'experimental',
  'other',
]);

const PATH_LIKE = /[\\/]|\.\.|^[a-zA-Z]:/;

export function requiredName(value: unknown, field: string, max = NAME_MAX): string {
  if (typeof value !== 'string') {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${field} is required.`);
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > max) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${field} must be between 1 and ${max} characters.`);
  }
  if (PATH_LIKE.test(name)) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${field} cannot contain a filesystem path.`);
  }
  return name;
}

export function optionalTrimmed(value: unknown, field: string, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${field} is invalid.`);
  }
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (text.length > max) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${field} must be at most ${max} characters.`);
  }
  if (PATH_LIKE.test(text)) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${field} cannot contain a filesystem path.`);
  }
  return text;
}

export function optionalInteger(value: unknown, field: string, min: number, max: number): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function optionalGenre(value: unknown): string | null {
  const genre = optionalTrimmed(value, 'genre', GENRE_MAX);
  if (!genre) return null;
  if (!ALLOWED_GENRES.has(genre.toLowerCase())) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'genre is not in the allowed list.');
  }
  return genre;
}

export function rejectClientAvailability(body: Record<string, unknown>): void {
  if ('available' in body || 'publication_state' in body || 'published' in body || 'rules_json' in body) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Client cannot set availability, publication, or rules_json.');
  }
}

export function sortNameFrom(name: string): string {
  return normalizeCatalogName(name);
}
