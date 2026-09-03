import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/appError.js';
import {
  isLocalFilePath,
  validateCoverArtPath,
  validatePlaylistName,
  validateRulesJson,
} from '../../src/playlists/validation.js';

describe('playlist validation', () => {
  it('trims names without inventing a new title', () => {
    expect(validatePlaylistName('  Harbor Mix  ')).toBe('Harbor Mix');
    expect(() => validatePlaylistName('   ')).toThrow(AppError);
  });

  it('rejects local cover paths and data URLs', () => {
    expect(isLocalFilePath('C:\\\\Music\\\\cover.jpg')).toBe(true);
    expect(isLocalFilePath('/Users/bang/cover.jpg')).toBe(true);
    expect(() => validateCoverArtPath('C:\\\\Music\\\\cover.jpg')).toThrow(AppError);
    expect(() => validateCoverArtPath('data:image/png;base64,aaaa')).toThrow(AppError);
    expect(validateCoverArtPath('https://cdn.example.test/covers/a.jpg')).toBe(
      'https://cdn.example.test/covers/a.jpg',
    );
    expect(validateCoverArtPath(null)).toBeNull();
  });

  it('requires rules_json to be valid JSON when present', () => {
    expect(validateRulesJson('{"genre":"ambient"}')).toBe('{"genre":"ambient"}');
    expect(() => validateRulesJson('{nope')).toThrow(AppError);
    expect(validateRulesJson(null)).toBeNull();
    expect(validateRulesJson('')).toBeNull();
    expect(validateRulesJson({ type: 'genre', value: 'ambient' })).toBe('{"type":"genre","value":"ambient"}');
  });
});
