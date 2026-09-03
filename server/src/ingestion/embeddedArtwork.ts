import { open, type FileHandle } from 'node:fs/promises';

const DEFAULT_MAX_PICTURE_BYTES = 20_000_000;
const MAX_FLAC_METADATA_OFFSET = 50_000_000;

export async function extractEmbeddedArtwork(
  filePath: string,
  maxBytes = DEFAULT_MAX_PICTURE_BYTES,
): Promise<Buffer | null> {
  const fromTags = await extractPictureFromAudioFile(filePath, maxBytes);
  if (fromTags) return fromTags;
  return null;
}

export async function extractPictureFromBuffer(
  buffer: Buffer,
  maxBytes = DEFAULT_MAX_PICTURE_BYTES,
): Promise<Buffer | null> {
  return extractPictureFromReader(new BufferReader(buffer), maxBytes);
}

async function extractPictureFromAudioFile(
  filePath: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const handle = await open(filePath, 'r');
  try {
    return await extractPictureFromReader(new FileReader(handle), maxBytes);
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

interface ByteReader {
  read(offset: number, size: number): Buffer | Promise<Buffer>;
}

class BufferReader implements ByteReader {
  constructor(private readonly buffer: Buffer) {}

  read(offset: number, size: number): Buffer {
    if (offset >= this.buffer.length || size <= 0) return Buffer.alloc(0);
    return this.buffer.subarray(offset, Math.min(offset + size, this.buffer.length));
  }
}

class FileReader implements ByteReader {
  constructor(private readonly handle: FileHandle) {}

  async read(offset: number, size: number): Promise<Buffer> {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await this.handle.read(buffer, 0, size, offset);
    return bytesRead === size ? buffer : buffer.subarray(0, bytesRead);
  }
}

async function asBuffer(value: Buffer | Promise<Buffer>): Promise<Buffer> {
  return value;
}

async function extractPictureFromReader(
  reader: ByteReader,
  maxBytes: number,
): Promise<Buffer | null> {
  const head = await asBuffer(reader.read(0, 32));
  if (head.length < 4) return null;
  if (head.toString('ascii', 0, 4) === 'fLaC') {
    return extractFlacPicture(reader, maxBytes);
  }
  if (head.toString('ascii', 0, 4) === 'DSD ') {
    return extractDsfPicture(reader, head, maxBytes);
  }
  if (head.toString('ascii', 0, 3) === 'ID3') {
    return extractId3Picture(reader, 0, maxBytes);
  }
  return null;
}

async function extractFlacPicture(reader: ByteReader, maxBytes: number): Promise<Buffer | null> {
  let offset = 4;
  const candidates: Array<{ type: number; body: Buffer }> = [];
  for (let index = 0; index < 64 && offset < MAX_FLAC_METADATA_OFFSET; index += 1) {
    const header = await asBuffer(reader.read(offset, 4));
    if (header.length < 4) break;
    const isLast = (header[0]! & 0x80) !== 0;
    const type = header[0]! & 0x7f;
    const length = header.readUIntBE(1, 3);
    offset += 4;
    if (type === 6 && length > 0 && length <= maxBytes + 512) {
      const block = await asBuffer(reader.read(offset, length));
      const parsed = parseFlacPictureBlock(block, maxBytes);
      if (parsed) candidates.push(parsed);
    }
    offset += length;
    if (isLast) break;
  }
  return pickCover(candidates);
}

function parseFlacPictureBlock(block: Buffer, maxBytes: number): { type: number; body: Buffer } | null {
  if (block.length < 32) return null;
  let offset = 0;
  const type = block.readUInt32BE(offset);
  offset += 4;
  const mimeLength = block.readUInt32BE(offset);
  offset += 4;
  if (mimeLength > 256 || offset + mimeLength + 4 > block.length) return null;
  offset += mimeLength;
  const descLength = block.readUInt32BE(offset);
  offset += 4;
  if (descLength > 65_536 || offset + descLength + 20 > block.length) return null;
  offset += descLength + 16;
  const dataLength = block.readUInt32BE(offset);
  offset += 4;
  if (dataLength <= 0 || dataLength > maxBytes || offset + dataLength > block.length) return null;
  const body = block.subarray(offset, offset + dataLength);
  return looksLikeImage(body) ? { type, body: Buffer.from(body) } : null;
}

async function extractDsfPicture(
  reader: ByteReader,
  head: Buffer,
  maxBytes: number,
): Promise<Buffer | null> {
  if (head.length < 28) return null;
  const metaOffset = Number(head.readBigUInt64LE(20));
  if (!Number.isSafeInteger(metaOffset) || metaOffset <= 0) return null;
  return extractId3Picture(reader, metaOffset, maxBytes);
}

async function extractId3Picture(
  reader: ByteReader,
  start: number,
  maxBytes: number,
): Promise<Buffer | null> {
  const header = await asBuffer(reader.read(start, 10));
  if (header.length < 10 || header.toString('ascii', 0, 3) !== 'ID3') return null;
  const version = header[3] ?? 0;
  if (version < 2 || version > 4) return null;
  const tagSize = synchsafe(header.subarray(6, 10));
  if (tagSize <= 0 || tagSize > maxBytes + 4096) return null;
  const tag = await asBuffer(reader.read(start + 10, tagSize));
  const unsynchronised = ((header[5] ?? 0) & 0x80) !== 0;
  const payload = unsynchronised ? removeUnsynchronisation(tag) : tag;
  return parseId3Frames(payload, version, maxBytes);
}

function parseId3Frames(data: Buffer, version: number, maxBytes: number): Buffer | null {
  const candidates: Array<{ type: number; body: Buffer }> = [];
  let pos = 0;
  const idSize = version === 2 ? 3 : 4;
  const sizeBytes = version === 2 ? 3 : 4;
  const headerSize = idSize + sizeBytes + (version === 2 ? 0 : 2);
  while (pos + headerSize <= data.length) {
    if (data[pos] === 0) break;
    const id = data.toString('ascii', pos, pos + idSize);
    const sizeOffset = pos + idSize;
    const frameSize = version === 2
      ? data.readUIntBE(sizeOffset, 3)
      : version >= 4
        ? synchsafe(data.subarray(sizeOffset, sizeOffset + 4))
        : data.readUInt32BE(sizeOffset);
    pos += headerSize;
    if (frameSize <= 0 || pos + frameSize > data.length) break;
    const frame = data.subarray(pos, pos + frameSize);
    if (id === 'APIC' || id === 'PIC') {
      const parsed = parseApic(frame, id === 'PIC', maxBytes);
      if (parsed) candidates.push(parsed);
    }
    pos += frameSize;
  }
  return pickCover(candidates);
}

function parseApic(payload: Buffer, v2: boolean, maxBytes: number): { type: number; body: Buffer } | null {
  if (payload.length < 6) return null;
  const encoding = payload[0] ?? 0;
  let pos = 1;
  if (v2) {
    pos += 3;
  } else {
    while (pos < payload.length && payload[pos] !== 0) pos += 1;
    pos += 1;
  }
  if (pos >= payload.length) return null;
  const type = payload[pos] ?? 0;
  pos += 1;
  const delimiter = encoding === 1 || encoding === 2 ? 2 : 1;
  while (pos + delimiter <= payload.length) {
    const done = delimiter === 1
      ? payload[pos] === 0
      : payload[pos] === 0 && payload[pos + 1] === 0;
    if (done) {
      pos += delimiter;
      break;
    }
    pos += 1;
  }
  if (pos >= payload.length) return null;
  const body = payload.subarray(pos);
  if (body.length <= 0 || body.length > maxBytes || !looksLikeImage(body)) return null;
  return { type, body: Buffer.from(body) };
}

function pickCover(candidates: Array<{ type: number; body: Buffer }>): Buffer | null {
  if (candidates.length === 0) return null;
  return (candidates.find((item) => item.type === 3)
    ?? candidates.find((item) => item.type === 0)
    ?? candidates[0])?.body ?? null;
}

function looksLikeImage(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return true;
  return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

function synchsafe(bytes: Buffer): number {
  if (bytes.length < 4) return 0;
  return ((bytes[0]! & 0x7f) << 21)
    | ((bytes[1]! & 0x7f) << 14)
    | ((bytes[2]! & 0x7f) << 7)
    | (bytes[3]! & 0x7f);
}

function removeUnsynchronisation(bytes: Buffer): Buffer {
  const out: number[] = [];
  let previousFf = false;
  for (const byte of bytes) {
    if (previousFf && byte === 0) {
      previousFf = false;
      continue;
    }
    previousFf = byte === 0xff;
    out.push(byte);
  }
  return Buffer.from(out);
}
