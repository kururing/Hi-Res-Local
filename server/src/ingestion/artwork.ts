export interface ArtworkVariant {
  name: string;
  width: number;
  height: number;
  format: 'webp' | 'jpeg' | 'avif' | 'png';
  objectKey: string;
  publicUrl: string;
  bytes: number;
}

export interface ProcessedArtwork {
  width: number;
  height: number;
  mimeType: string;
  variants: Array<ArtworkVariant & { body: Buffer }>;
}

export interface ArtworkProcessor {
  process(input: Buffer): Promise<ProcessedArtwork>;
}

export class ArtworkError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ArtworkError';
    this.code = code;
    this.retryable = retryable;
  }
}

const VARIANT_SIZES = [64, 300, 1200] as const;

export async function createSharpArtworkProcessor(
  maxBytes: number,
  maxPixels: number,
): Promise<ArtworkProcessor> {
  const sharpModule = await import('sharp');
  const sharp = sharpModule.default;
  sharp.cache(false);

  return {
    async process(input: Buffer): Promise<ProcessedArtwork> {
      if (input.length > maxBytes) {
        throw new ArtworkError('ARTWORK_TOO_LARGE', 'Artwork exceeds the byte limit.');
      }
      if (input.slice(0, 256).includes(Buffer.from('<svg', 'utf8'))) {
        throw new ArtworkError('ARTWORK_SVG_REJECTED', 'SVG artwork is not accepted.');
      }

      let image = sharp(input, {
        failOn: 'error',
        limitInputPixels: maxPixels,
      }).rotate();

      const meta = await image.metadata();
      if (!meta.width || !meta.height) {
        throw new ArtworkError('ARTWORK_INVALID', 'Could not decode image dimensions.');
      }
      if (meta.format === 'svg') {
        throw new ArtworkError('ARTWORK_SVG_REJECTED', 'SVG artwork is not accepted.');
      }
      if (meta.width * meta.height > maxPixels) {
        throw new ArtworkError('ARTWORK_TOO_MANY_PIXELS', 'Artwork exceeds the pixel limit.');
      }

      image = image.rotate().withMetadata({ orientation: undefined });

      const variants: ProcessedArtwork['variants'] = [];
      for (const size of VARIANT_SIZES) {
        const resized = image.clone().resize(size, size, { fit: 'cover', withoutEnlargement: true });
        let format: ArtworkVariant['format'] = 'webp';
        let body: Buffer;
        try {
          body = await resized.webp({ quality: 82 }).toBuffer();
        } catch {
          format = 'jpeg';
          body = await resized.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        }
        const info = await sharp(body).metadata();
        variants.push({
          name: `${size}`,
          width: info.width ?? size,
          height: info.height ?? size,
          format,
          objectKey: '',
          publicUrl: '',
          bytes: body.length,
          body,
        });
      }

      return {
        width: meta.width,
        height: meta.height,
        mimeType: meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : 'image/jpeg',
        variants,
      };
    },
  };
}

export class FakeArtworkProcessor implements ArtworkProcessor {
  fail = false;
  lastInput: Buffer | null = null;

  async process(input: Buffer): Promise<ProcessedArtwork> {
    this.lastInput = input;
    if (this.fail) throw new ArtworkError('ARTWORK_INVALID', 'Fake artwork processor rejected the file.');
    if (input.slice(0, 5).includes(Buffer.from('<svg'))) {
      throw new ArtworkError('ARTWORK_SVG_REJECTED', 'SVG artwork is not accepted.');
    }
    return {
      width: 16,
      height: 16,
      mimeType: 'image/png',
      variants: VARIANT_SIZES.map((size) => ({
        name: `${size}`,
        width: size,
        height: size,
        format: 'webp' as const,
        objectKey: '',
        publicUrl: '',
        bytes: 32,
        body: Buffer.from(`fake-webp-${size}`),
      })),
    };
  }
}
