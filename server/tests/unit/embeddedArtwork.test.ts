import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractEmbeddedArtwork, extractPictureFromBuffer } from '../../src/ingestion/embeddedArtwork.js';
import {
  createSyntheticDsfWithPicture,
  createSyntheticFlacWithPicture,
  createSyntheticId3WithPicture,
  createSyntheticPng,
  createSyntheticWav,
} from '../../src/media/synthetic.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('embedded artwork extraction', () => {
  it('reads a FLAC PICTURE block natively', async () => {
    const png = createSyntheticPng().body;
    const extracted = await extractPictureFromBuffer(createSyntheticFlacWithPicture(png));
    expect(extracted).toEqual(png);
  });

  it('reads ID3 APIC and DSF ID3 artwork natively', async () => {
    const png = createSyntheticPng().body;
    expect(await extractPictureFromBuffer(createSyntheticId3WithPicture(png))).toEqual(png);
    expect(await extractPictureFromBuffer(createSyntheticDsfWithPicture(png))).toEqual(png);
  });

  it('returns null when the file has no attached picture', async () => {
    expect(await extractPictureFromBuffer(createSyntheticWav().body)).toBeNull();
    expect(await extractPictureFromBuffer(Buffer.from('not-audio'))).toBeNull();
  });

  it('extracts cover from a temporary FLAC file', async () => {
    const png = createSyntheticPng().body;
    const dir = await mkdtemp(path.join(tmpdir(), 'nnpm-art-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'cover.flac');
    await writeFile(filePath, createSyntheticFlacWithPicture(png));
    const extracted = await extractEmbeddedArtwork(filePath);
    expect(extracted).toEqual(png);
  });
});
