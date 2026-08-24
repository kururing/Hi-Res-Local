import { describe, expect, it } from 'vitest';
import { formatQualityLabel, normalizeLibraryTrack } from '../services/trackPresentation';
import { Track } from '../types/library';

const baseTrack = {
  id: 'light',
  title: 'Light',
  artist: 'Wanna One',
  album: '1÷x=1',
  path: 'D:/Music/Light.mp3',
  date_added: '2026-08-24T00:00:00.000Z',
} as Track;

describe('track presentation', () => {
  it('normalizes backend milliseconds and artwork fields', () => {
    const track = normalizeLibraryTrack({
      ...baseTrack,
      duration: 0,
      duration_ms: 183_250,
      cover_art_path: 'C:/cache/light.jpg',
    });

    expect(track.duration).toBe(183.25);
    expect(track.cover_art_path).toBe('C:/cache/light.jpg');
  });

  it('never renders N/A in a compact quality badge', () => {
    expect(formatQualityLabel({
      ...baseTrack,
      duration: 183,
      format: 'MP3',
      sample_rate: 44_100,
    })).toBe('44.1 kHz');
  });

  it('uses bitrate when bit depth is unavailable', () => {
    expect(formatQualityLabel({
      ...baseTrack,
      duration: 183,
      format: 'MP3',
      sample_rate: 44_100,
      bitrate: 320,
    })).toBe('320 kbps / 44.1 kHz');
  });

  it('shows bit depth before sample rate without repeating the format', () => {
    expect(formatQualityLabel({
      ...baseTrack,
      duration: 183,
      format: 'FLAC',
      sample_rate: 96_000,
      bit_depth: 24,
    })).toBe('24-bit / 96 kHz');
  });
});
