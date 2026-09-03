import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFlagArgs } from '../src/cli/args.js';
import { createSyntheticPng, createSyntheticWav } from '../src/media/synthetic.js';

const args = parseFlagArgs(process.argv.slice(2));
const outDir = typeof args.dir === 'string'
  ? path.resolve(args.dir)
  : path.join(tmpdir(), `nnpm-media-${Date.now()}`);

await mkdir(outDir, { recursive: true });
const wav = createSyntheticWav();
const png = createSyntheticPng();
const wavPath = path.join(outDir, 'synthetic.wav');
const pngPath = path.join(outDir, 'synthetic.png');
await writeFile(wavPath, wav.body);
await writeFile(pngPath, png.body);

const report = {
  directory: outDir,
  wav: {
    path: wavPath,
    size: wav.size,
    sha256: wav.sha256,
    duration_seconds: wav.durationSeconds,
    duration_tolerance_seconds: wav.durationToleranceSeconds,
    codec: wav.codec,
    container: wav.container,
    sample_rate_hz: wav.sampleRateHz,
    bit_depth: wav.bitDepth,
    channels: wav.channels,
    mime_type: wav.mimeType,
  },
  artwork: {
    path: pngPath,
    size: png.size,
    sha256: png.sha256,
    mime_type: png.mimeType,
    width: png.width,
    height: png.height,
  },
};

console.log(JSON.stringify(report, null, 2));
