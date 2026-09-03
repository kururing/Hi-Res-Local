import { describe, expect, it } from 'vitest';
import { FakeArtworkProcessor } from '../../src/ingestion/artwork.js';

describe('fake artwork processor', () => {
  it('rejects SVG and keeps a decode path for valid buffers', async () => {
    const processor = new FakeArtworkProcessor();
    await expect(processor.process(Buffer.from('<svg></svg>'))).rejects.toMatchObject({
      code: 'ARTWORK_SVG_REJECTED',
    });
    const result = await processor.process(Buffer.from('png-bytes'));
    expect(result.variants).toHaveLength(3);
    expect(result.variants[0]?.format).toBe('webp');
  });
});
