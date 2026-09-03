import { describe, expect, it } from 'vitest';
import { audioTempExtension } from '../../src/admin/mediaTypes.js';
import { audioMimeType, formatsCompatible, normalizeCodec, normalizeContainer } from '../../src/streaming/mime.js';

describe('audio MIME mapping', () => {
  it('maps catalog codec/container pairs to browser MIME types', () => {
    expect(audioMimeType('flac', 'flac')).toBe('audio/flac');
    expect(audioMimeType('mp3', 'mp3')).toBe('audio/mpeg');
    expect(audioMimeType('aac', 'm4a')).toBe('audio/mp4');
    expect(audioMimeType('alac', 'm4a')).toBe('audio/mp4');
    expect(audioMimeType('opus', 'webm')).toBe('audio/webm');
    expect(audioMimeType('opus', 'ogg')).toBe('audio/ogg');
    expect(audioMimeType('vorbis', 'ogg')).toBe('audio/ogg');
    expect(audioMimeType('pcm', 'wav')).toBe('audio/wav');
  });

  it('normalizes aliases before mapping', () => {
    expect(normalizeCodec('MP4A')).toBe('aac');
    expect(normalizeContainer('MP4')).toBe('m4a');
    expect(audioMimeType('wav', 'wave')).toBe('audio/wav');
  });

  it('matches compatible format hints without leaking unknown pairs', () => {
    expect(formatsCompatible(
      { codec: 'flac', container: 'flac' },
      { codec: 'FLAC', container: 'flac', mimeType: 'audio/flac' },
    )).toBe(true);
    expect(formatsCompatible(
      { codec: 'aac', container: 'm4a' },
      { codec: 'aac', container: 'mp4' },
    )).toBe(true);
    expect(formatsCompatible(
      { codec: 'flac', container: 'flac' },
      { codec: 'mp3', container: 'mp3' },
    )).toBe(false);
    expect(audioMimeType('dsd', 'dsf')).toBe('audio/dsf');
    expect(audioMimeType('dsd', 'dff')).toBe('audio/dff');
    expect(audioMimeType('wmav2', 'avi')).toBeUndefined();
  });
});

describe('audio temp extension', () => {
  it('keeps the original audio suffix so nnpm-probe can detect the container', () => {
    expect(audioTempExtension('track.flac')).toBe('.flac');
    expect(audioTempExtension('song.m4a')).toBe('.m4a');
    expect(audioTempExtension('dump.bin', 'audio/flac')).toBe('.flac');
    expect(audioTempExtension('dump.bin')).toBe('.bin');
  });
});
