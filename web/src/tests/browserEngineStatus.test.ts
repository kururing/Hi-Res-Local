import { describe, expect, it } from 'vitest';
import {
  BROWSER_HTML_AUDIO_MODE,
  BROWSER_WEB_AUDIO_MODE,
  buildBrowserEngineStatus,
  emptyBrowserEngineStatus,
  formatAudioRate,
  formatPcmLabel,
} from '../audio/browserEngineStatus';
import type { StreamDescriptor } from '../platform/streaming/types';
import type { Track } from '../types/library';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    title: 'Lanterns',
    artist: 'Aurora',
    album: 'Glass',
    duration: 180,
    path: '',
    date_added: '2026-08-30T00:00:00.000Z',
    format: 'flac',
    sample_rate: 96_000,
    bit_depth: 24,
    ...overrides,
  };
}

function descriptor(overrides: Partial<StreamDescriptor['asset']> = {}): StreamDescriptor {
  return {
    url: 'https://storage.example.test/a.flac',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    asset: {
      codec: 'flac',
      container: 'flac',
      sampleRateHz: 96_000,
      bitDepth: 24,
      channels: 2,
      bitrateKbps: null,
      lossless: true,
      ...overrides,
    },
  };
}

describe('browserEngineStatus', () => {
  it('formats PCM rates and labels', () => {
    expect(formatAudioRate(44_100)).toBe('44.1 kHz');
    expect(formatAudioRate(2_822_400)).toBe('2.8 MHz');
    expect(formatPcmLabel(24, 96_000)).toBe('PCM 24-bit / 96 kHz');
  });

  it('clears live telemetry with an empty status', () => {
    expect(emptyBrowserEngineStatus(0.4)).toMatchObject({
      output_mode: '',
      output_sample_rate: 0,
      volume: 0.4,
      volume_control_kind: 'software',
    });
  });

  it('reports HTMLAudio shared PCM without claiming WASAPI', () => {
    const status = buildBrowserEngineStatus({
      track: track(),
      descriptor: descriptor(),
      volume: 0.5,
      dsd: false,
    });
    expect(status.output_mode).toBe(BROWSER_HTML_AUDIO_MODE);
    expect(status.backend).toBe('shared');
    expect(status.bit_perfect).toBe(false);
    expect(status.dsd_transport).toBeNull();
    expect(status.source_format).toContain('FLAC');
    expect(status.source_format).toContain('24-bit');
    expect(status.output_format).toBe('PCM 32-bit / 96 kHz');
    expect(JSON.stringify(status)).not.toMatch(/WASAPI/);
  });

  it('reports Web Audio DSD decoded to PCM', () => {
    const status = buildBrowserEngineStatus({
      track: track({ format: 'dsf', sample_rate: 2_822_400, bit_depth: 1 }),
      descriptor: descriptor({
        codec: 'dsd',
        container: 'dsf',
        sampleRateHz: 2_822_400,
        bitDepth: 1,
        isDsd: true,
        dsdRate: 64,
      }),
      volume: 1,
      dsd: true,
      dsdOutputSampleRate: 88_200,
      dsdRate: 64,
    });
    expect(status.output_mode).toBe(BROWSER_WEB_AUDIO_MODE);
    expect(status.dsd_transport).toBe('pcm');
    expect(status.dsd_rate).toBe('dsd64');
    expect(status.source_format).toBe('DSD64');
    expect(status.output_format).toBe('PCM 32-bit / 88.2 kHz');
    expect(status.output_bit_depth).toBe(32);
  });
});
