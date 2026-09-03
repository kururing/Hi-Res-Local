import { createHash } from 'node:crypto';

export const SYNTHETIC_WAV = {
  sampleRateHz: 44_100,
  channels: 2,
  bitDepth: 16,
  durationSeconds: 3,
  container: 'wav',
  codec: 'pcm',
  mimeType: 'audio/wav',
  durationToleranceSeconds: 0.25,
} as const;

export interface SyntheticWavFixture {
  body: Buffer;
  size: number;
  sha256: string;
  sampleRateHz: number;
  channels: number;
  bitDepth: number;
  durationSeconds: number;
  container: string;
  codec: string;
  mimeType: string;
  durationToleranceSeconds: number;
}

export function createSyntheticWav(options?: {
  sampleRateHz?: number;
  channels?: number;
  durationSeconds?: number;
  frequencyHz?: number;
  tags?: {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    track?: string;
  };
}): SyntheticWavFixture {
  const sampleRateHz = options?.sampleRateHz ?? SYNTHETIC_WAV.sampleRateHz;
  const channels = options?.channels ?? SYNTHETIC_WAV.channels;
  const durationSeconds = options?.durationSeconds ?? SYNTHETIC_WAV.durationSeconds;
  const frequencyHz = options?.frequencyHz ?? 440;
  const bytesPerSample = SYNTHETIC_WAV.bitDepth / 8;
  const frameCount = sampleRateHz * durationSeconds;
  const dataSize = frameCount * channels * bytesPerSample;
  const body = Buffer.alloc(44 + dataSize);

  body.write('RIFF', 0);
  body.writeUInt32LE(36 + dataSize, 4);
  body.write('WAVE', 8);
  body.write('fmt ', 12);
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20);
  body.writeUInt16LE(channels, 22);
  body.writeUInt32LE(sampleRateHz, 24);
  body.writeUInt32LE(sampleRateHz * channels * bytesPerSample, 28);
  body.writeUInt16LE(channels * bytesPerSample, 32);
  body.writeUInt16LE(SYNTHETIC_WAV.bitDepth, 34);
  body.write('data', 36);
  body.writeUInt32LE(dataSize, 40);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * frame) / sampleRateHz);
    const pcm = Math.max(-1, Math.min(1, sample * 0.2));
    const int16 = Math.round(pcm * 32_767);
    for (let channel = 0; channel < channels; channel += 1) {
      body.writeInt16LE(int16, 44 + (frame * channels + channel) * bytesPerSample);
    }
  }

  const tagged = options?.tags ? Buffer.concat([body, wavListInfo(options.tags)]) : body;
  if (options?.tags) tagged.writeUInt32LE(tagged.length - 8, 4);

  return {
    body: tagged,
    size: tagged.length,
    sha256: createHash('sha256').update(tagged).digest('hex'),
    sampleRateHz,
    channels,
    bitDepth: SYNTHETIC_WAV.bitDepth,
    durationSeconds,
    container: SYNTHETIC_WAV.container,
    codec: SYNTHETIC_WAV.codec,
    mimeType: SYNTHETIC_WAV.mimeType,
    durationToleranceSeconds: SYNTHETIC_WAV.durationToleranceSeconds,
  };
}

export interface SyntheticPngFixture {
  body: Buffer;
  size: number;
  sha256: string;
  mimeType: 'image/png';
  width: number;
  height: number;
}

/** Deterministic 8x8 RGB PNG generated without native image libraries. */
export function createSyntheticFlacWithPicture(picture = createSyntheticPng().body): Buffer {
  const streamInfo = flacBlock(0, false, Buffer.alloc(34));
  const pictureBlock = flacBlock(6, true, flacPicturePayload(picture));
  return Buffer.concat([Buffer.from('fLaC'), streamInfo, pictureBlock]);
}

export function createSyntheticId3WithPicture(picture = createSyntheticPng().body): Buffer {
  const mime = Buffer.from('image/png\0');
  const apicPayload = Buffer.concat([
    Buffer.from([0x00]),
    mime,
    Buffer.from([0x03]),
    Buffer.from([0x00]),
    picture,
  ]);
  const frame = Buffer.alloc(10 + apicPayload.length);
  frame.write('APIC', 0, 4, 'ascii');
  frame.writeUInt32BE(apicPayload.length, 4);
  apicPayload.copy(frame, 10);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 3, 'ascii');
  header[3] = 3;
  const size = synchsafe32(frame.length);
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  return Buffer.concat([header, frame]);
}

export function createSyntheticDsfWithPicture(picture = createSyntheticPng().body): Buffer {
  const id3 = createSyntheticId3WithPicture(picture);
  const header = Buffer.alloc(28);
  header.write('DSD ', 0, 4, 'ascii');
  header.writeBigUInt64LE(28n, 4);
  header.writeBigUInt64LE(BigInt(28 + id3.length), 12);
  header.writeBigUInt64LE(28n, 20);
  return Buffer.concat([header, id3]);
}

function flacBlock(type: number, last: boolean, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (last ? 0x80 : 0) | type;
  header.writeUIntBE(data.length, 1, 3);
  return Buffer.concat([header, data]);
}

function flacPicturePayload(picture: Buffer): Buffer {
  const mime = Buffer.from('image/png');
  const body = Buffer.alloc(32 + mime.length + picture.length);
  let offset = 0;
  body.writeUInt32BE(3, offset);
  offset += 4;
  body.writeUInt32BE(mime.length, offset);
  offset += 4;
  mime.copy(body, offset);
  offset += mime.length;
  body.writeUInt32BE(0, offset);
  offset += 4;
  body.writeUInt32BE(8, offset);
  offset += 4;
  body.writeUInt32BE(8, offset);
  offset += 4;
  body.writeUInt32BE(24, offset);
  offset += 4;
  body.writeUInt32BE(0, offset);
  offset += 4;
  body.writeUInt32BE(picture.length, offset);
  offset += 4;
  picture.copy(body, offset);
  return body;
}

function synchsafe32(value: number): number {
  return ((value & 0x7f) | ((value & 0x3f80) << 1) | ((value & 0x1fc000) << 2) | ((value & 0xfe00000) << 3)) >>> 0;
}

export function createSyntheticPng(): SyntheticPngFixture {
  const width = 8;
  const height = 8;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = row + 1 + x * 3;
      raw[i] = 32 + x * 16;
      raw[i + 1] = 64 + y * 16;
      raw[i + 2] = 160;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const chunks = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  return {
    body: chunks,
    size: chunks.length,
    sha256: createHash('sha256').update(chunks).digest('hex'),
    mimeType: 'image/png',
    width,
    height,
  };
}

function wavInfoChunk(id: string, value: string): Buffer {
  const data = Buffer.from(`${value}\0`, 'ascii');
  const padded = data.length % 2 === 0 ? data : Buffer.concat([data, Buffer.from([0])]);
  const chunk = Buffer.alloc(8 + padded.length);
  chunk.write(id, 0, 4, 'ascii');
  chunk.writeUInt32LE(data.length, 4);
  padded.copy(chunk, 8);
  return chunk;
}

function wavListInfo(tags: {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  track?: string;
}): Buffer {
  const chunks: Buffer[] = [];
  if (tags.title) chunks.push(wavInfoChunk('INAM', tags.title));
  if (tags.artist) chunks.push(wavInfoChunk('IART', tags.artist));
  if (tags.album) chunks.push(wavInfoChunk('IPRD', tags.album));
  if (tags.year) chunks.push(wavInfoChunk('ICRD', tags.year));
  if (tags.genre) chunks.push(wavInfoChunk('IGNR', tags.genre));
  if (tags.track) chunks.push(wavInfoChunk('ITRK', tags.track));
  const inner = Buffer.concat([Buffer.from('INFO', 'ascii'), ...chunks]);
  const list = Buffer.alloc(8 + inner.length);
  list.write('LIST', 0, 4, 'ascii');
  list.writeUInt32LE(inner.length, 4);
  inner.copy(list, 8);
  return list;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBuf, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(payload), 8 + data.length);
  return chunk;
}

function zlibSync(data: Buffer): Buffer {
  // Stored (uncompressed) deflate block — valid zlib, deterministic.
  const blocks: Buffer[] = [];
  let offset = 0;
  while (offset < data.length) {
    const size = Math.min(65_535, data.length - offset);
    const last = offset + size >= data.length ? 1 : 0;
    const block = Buffer.alloc(5 + size);
    block[0] = last;
    block.writeUInt16LE(size, 1);
    block.writeUInt16LE(0xffff ^ size, 3);
    data.copy(block, 5, offset, offset + size);
    blocks.push(block);
    offset += size;
  }
  const deflate = Buffer.concat(blocks);
  const zlib = Buffer.alloc(2 + deflate.length + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  deflate.copy(zlib, 2);
  zlib.writeUInt32BE(adler32(data), 2 + deflate.length);
  return zlib;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(data: Buffer): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
