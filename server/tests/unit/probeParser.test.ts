import { describe, expect, it } from 'vitest';
import { parseNnpmProbeJson, ProbeError } from '../../src/ingestion/probe.js';

const flac = JSON.stringify({
  format: { format_name: 'flac', duration: '180.5', bit_rate: '900000' },
  streams: [{
    codec_type: 'audio',
    codec_name: 'flac',
    sample_rate: '44100',
    channels: 2,
    bits_per_raw_sample: '16',
    duration: '180.5',
  }],
});

describe('nnpm-probe JSON parser', () => {
  it('parses a supported FLAC stream', () => {
    expect(parseNnpmProbeJson(flac)).toMatchObject({
      container: 'flac',
      codec: 'flac',
      durationSeconds: 180.5,
      sampleRateHz: 44_100,
      bitDepth: 16,
      channels: 2,
      isLossless: true,
      hasAudioStream: true,
    });
  });

  it('accepts DSD when nnpm-probe reports a dsd_* codec or dsd format name', () => {
    expect(parseNnpmProbeJson(JSON.stringify({
      format: { format_name: 'dsf', duration: '12' },
      streams: [{
        codec_type: 'audio',
        codec_name: 'dsd_lsbf_planar',
        sample_rate: '705600',
        channels: 2,
        duration: '12',
      }],
    }))).toMatchObject({
      container: 'dsf',
      codec: 'dsd',
      sampleRateHz: 705_600,
      dsd: true,
      isLossless: true,
    });
    expect(parseNnpmProbeJson(JSON.stringify({
      format: { format_name: 'dsd', duration: '8' },
      streams: [{
        codec_type: 'audio',
        codec_name: 'dsd_msbf',
        sample_rate: '2822400',
        channels: 2,
        duration: '8',
      }],
    }))).toMatchObject({
      container: 'dsf',
      codec: 'dsd',
      dsd: true,
    });
  });

  it('parses nnpm-probe JSON without embedded artwork', () => {
    expect(parseNnpmProbeJson(JSON.stringify({
      container: 'flac',
      codec: 'flac',
      duration_seconds: 180.5,
      sample_rate_hz: 44100,
      bit_depth: 16,
      channels: 2,
      is_lossless: true,
      hi_res: false,
      dsd: false,
      has_audio_stream: true,
      has_attached_picture: true,
      tags: { title: 'Song', artist: 'Band', album: 'LP' },
    }))).toMatchObject({
      container: 'flac',
      codec: 'flac',
      durationSeconds: 180.5,
      sampleRateHz: 44_100,
      bitDepth: 16,
      channels: 2,
      isLossless: true,
      hasAttachedPicture: true,
      tags: { title: 'Song', artist: 'Band', album: 'LP' },
    });
  });

  it('rejects invalid JSON, missing audio, and unsupported formats', () => {
    expect(() => parseNnpmProbeJson('nope')).toThrow(ProbeError);
    expect(() => parseNnpmProbeJson(JSON.stringify({ streams: [{ codec_type: 'video' }] }))).toThrow(/No audio stream/);
    expect(() => parseNnpmProbeJson(JSON.stringify({
      format: { format_name: 'avi', duration: '1' },
      streams: [{ codec_type: 'audio', codec_name: 'wmav2', sample_rate: '44100', channels: 2, duration: '1' }],
    }))).toThrow(/Unsupported/);
  });
});
