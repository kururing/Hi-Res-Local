import { describe, expect, it } from 'vitest';
import { sanitizePreferences } from '../../src/preferences/allowlist.js';

describe('portable preferences allowlist', () => {
  it('keeps portable fields and drops device-only paths', () => {
    const sanitized = sanitizePreferences({
      language: 'en',
      theme: 'midnight',
      streaming_quality: 'max',
      music_folders: ['C:\\Music'],
      output_device: 'wasapi',
      signed_url: 'https://example.test/secret',
    });
    expect(sanitized).toEqual({
      language: 'en',
      theme: 'midnight',
    });
  });
});
