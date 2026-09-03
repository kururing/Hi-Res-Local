import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createSyntheticDsfWithPicture, createSyntheticFlacWithPicture, createSyntheticId3WithPicture, createSyntheticPng, createSyntheticWav } from '../../src/media/synthetic.js';

describe('synthetic media fixtures', () => {
  it('generates a deterministic WAV with expected PCM metadata', () => {
    const first = createSyntheticWav();
    const second = createSyntheticWav();
    expect(first.size).toBe(second.size);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toBe(createHash('sha256').update(first.body).digest('hex'));
    expect(first.codec).toBe('pcm');
    expect(first.container).toBe('wav');
    expect(first.sampleRateHz).toBe(44_100);
    expect(first.bitDepth).toBe(16);
    expect(first.channels).toBe(2);
    expect(first.durationSeconds).toBeGreaterThanOrEqual(2);
    expect(first.durationSeconds).toBeLessThanOrEqual(5);
    expect(first.body.toString('ascii', 0, 4)).toBe('RIFF');
    const tagged = createSyntheticWav({ tags: { title: 'Tagged', artist: 'A', album: 'B' } });
    expect(tagged.sha256).not.toBe(first.sha256);
    expect(tagged.body.includes(Buffer.from('INAM'))).toBe(true);
  });

  it('generates a small deterministic PNG', () => {
    const png = createSyntheticPng();
    expect(png.mimeType).toBe('image/png');
    expect(png.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.size).toBe(png.body.length);
    expect(png.sha256).toHaveLength(64);
  });

  it('embeds that PNG into FLAC, ID3, and DSF fixtures', () => {
    const png = createSyntheticPng().body;
    expect(createSyntheticFlacWithPicture(png).toString('ascii', 0, 4)).toBe('fLaC');
    expect(createSyntheticId3WithPicture(png).toString('ascii', 0, 3)).toBe('ID3');
    expect(createSyntheticDsfWithPicture(png).toString('ascii', 0, 4)).toBe('DSD ');
  });
});
