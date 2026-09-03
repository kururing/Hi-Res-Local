import { describe, expect, it } from 'vitest';
import {
  ClientFormatUnsupportedError,
  QualityUnavailableError,
  selectAudioAsset,
  type SelectableAsset,
} from '../../src/streaming/assetSelector.js';

function asset(overrides: Partial<SelectableAsset> & Pick<SelectableAsset, 'id'>): SelectableAsset {
  return {
    storageKey: `keys/${overrides.id}`,
    container: 'flac',
    codec: 'flac',
    sampleRateHz: 44_100,
    bitDepth: 16,
    channels: 2,
    bitrateKbps: 900,
    durationSeconds: 180,
    isLossless: true,
    available: true,
    ...overrides,
  };
}

const hiRes = asset({
  id: 'hi-res',
  storageKey: 'keys/hi-res.flac',
  sampleRateHz: 96_000,
  bitDepth: 24,
  bitrateKbps: 3200,
  isLossless: true,
});
const cd = asset({
  id: 'cd',
  storageKey: 'keys/cd.flac',
  sampleRateHz: 44_100,
  bitDepth: 16,
  bitrateKbps: 900,
  isLossless: true,
});
const mp3_320 = asset({
  id: 'mp3-320',
  storageKey: 'keys/320.mp3',
  container: 'mp3',
  codec: 'mp3',
  bitDepth: null,
  bitrateKbps: 320,
  isLossless: false,
});
const mp3_128 = asset({
  id: 'mp3-128',
  storageKey: 'keys/128.mp3',
  container: 'mp3',
  codec: 'mp3',
  bitDepth: null,
  bitrateKbps: 128,
  isLossless: false,
});

describe('selectAudioAsset', () => {
  it('selects the highest fidelity asset for max', () => {
    expect(selectAudioAsset([cd, mp3_320, hiRes], 'max').id).toBe('hi-res');
  });

  it('selects only lossless assets for lossless and errors otherwise', () => {
    expect(selectAudioAsset([cd, mp3_320, hiRes], 'lossless').id).toBe('hi-res');
    expect(() => selectAudioAsset([mp3_320, mp3_128], 'lossless')).toThrow(QualityUnavailableError);
  });

  it('prefers high-bitrate lossy for high, then CD lossless, and does not silently pick hi-res', () => {
    expect(selectAudioAsset([hiRes, cd, mp3_320, mp3_128], 'high').id).toBe('mp3-320');
    expect(selectAudioAsset([hiRes, cd, mp3_128], 'high').id).toBe('cd');
    expect(() => selectAudioAsset([hiRes, mp3_128], 'high')).toThrow(QualityUnavailableError);
  });

  it('uses auto fallback: standard lossless, then lossy, then max', () => {
    expect(selectAudioAsset([hiRes, cd, mp3_320], 'auto').id).toBe('cd');
    expect(selectAudioAsset([hiRes, mp3_320, mp3_128], 'auto').id).toBe('mp3-320');
    expect(selectAudioAsset([hiRes], 'auto').id).toBe('hi-res');
  });

  it('ignores unavailable assets', () => {
    expect(() => selectAudioAsset([{ ...hiRes, available: false }], 'max')).toThrow(QualityUnavailableError);
    expect(selectAudioAsset([{ ...hiRes, available: false }, cd], 'max').id).toBe('cd');
  });

  it('never mutates asset parameters', () => {
    const selected = selectAudioAsset([hiRes], 'max');
    expect(selected.sampleRateHz).toBe(96_000);
    expect(selected.bitDepth).toBe(24);
    expect(selected.storageKey).toBe('keys/hi-res.flac');
  });

  it('ignores supported_formats when omitted so older clients keep working', () => {
    expect(selectAudioAsset([cd, mp3_320, hiRes], 'max').id).toBe('hi-res');
    expect(selectAudioAsset([cd, mp3_320, hiRes], 'auto').id).toBe('cd');
  });

  it('filters unsupported formats before applying quality policy', () => {
    const mp3Only = [{ codec: 'mp3', container: 'mp3', mimeType: 'audio/mpeg' }];
    expect(selectAudioAsset([hiRes, cd, mp3_320], 'auto', mp3Only).id).toBe('mp3-320');
    expect(() => selectAudioAsset([hiRes, cd, mp3_320], 'max', mp3Only)).toThrow(ClientFormatUnsupportedError);
    expect(() => selectAudioAsset([hiRes, cd, mp3_320], 'lossless', mp3Only)).toThrow(QualityUnavailableError);
  });

  it('keeps auto fallback inside the supported set', () => {
    const flacAndMp3 = [
      { codec: 'flac', container: 'flac', mimeType: 'audio/flac' },
      { codec: 'mp3', container: 'mp3', mimeType: 'audio/mpeg' },
    ];
    expect(selectAudioAsset([hiRes, mp3_320], 'auto', flacAndMp3).id).toBe('mp3-320');
  });

  it('does not silently fall back for lossless and treats max as best supported asset', () => {
    const flacOnly = [{ codec: 'flac', container: 'flac' }];
    expect(() => selectAudioAsset([mp3_320], 'lossless', flacOnly)).toThrow(ClientFormatUnsupportedError);
    expect(selectAudioAsset([cd, hiRes, mp3_320], 'max', flacOnly).id).toBe('hi-res');
  });

  it('errors when the client has no compatible format', () => {
    expect(() => selectAudioAsset([cd, mp3_320], 'auto', [
      { codec: 'opus', container: 'webm', mimeType: 'audio/webm' },
    ])).toThrow(ClientFormatUnsupportedError);
  });

  it('maps original/hires/compatible/data-saver without transcoding', () => {
    expect(selectAudioAsset([cd, mp3_320, hiRes], 'original').id).toBe('hi-res');
    expect(selectAudioAsset([cd, mp3_320, hiRes], 'hires').id).toBe('hi-res');
    expect(selectAudioAsset([hiRes, cd, mp3_320], 'compatible').id).toBe('mp3-320');
    expect(selectAudioAsset([mp3_320, mp3_128], 'data-saver').id).toBe('mp3-128');
    expect(() => selectAudioAsset([cd, hiRes], 'data-saver')).toThrow(QualityUnavailableError);
  });
});
