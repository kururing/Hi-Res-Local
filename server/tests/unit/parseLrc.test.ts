import { describe, expect, it } from 'vitest';
import { parseLrc } from '../../src/lyrics/parseLrc.js';

describe('parseLrc', () => {
  it('parses synced timestamps in seconds, including centiseconds', () => {
    const parsed = parseLrc([
      '[ti:Lanterns]',
      '[ar:Aurora Circuit]',
      '[al:Glass Harbor]',
      '[by:Test]',
      '[offset:0]',
      '[00:12.34]First line',
      '[01:02.500]Millisecond line',
      '[00:12.34][00:20.00]Repeated stamp',
    ].join('\n'));

    expect(parsed.is_synced).toBe(true);
    expect(parsed.title).toBe('Lanterns');
    expect(parsed.artist).toBe('Aurora Circuit');
    expect(parsed.album).toBe('Glass Harbor');
    expect(parsed.by).toBe('Test');
    expect(parsed.lines[0]).toEqual({ timestamp_seconds: 12.34, text: 'First line' });
    expect(parsed.lines.some((line) => line.timestamp_seconds === 62.5 && line.text === 'Millisecond line')).toBe(true);
    expect(parsed.lines.filter((line) => line.text === 'Repeated stamp')).toHaveLength(2);
  });

  it('treats plain text without timestamps as unsynced', () => {
    const parsed = parseLrc('Just a test lyric\nSecond line');
    expect(parsed.is_synced).toBe(false);
    expect(parsed.lines).toEqual([]);
    expect(parsed.plain_text).toContain('Just a test lyric');
  });

  it('strips LRCLIB karaoke agent tags and word timings', () => {
    const parsed = parseLrc(
      '[02:54.18]{Agent:v1}Come my<Come:174.186:174.618|my:174.618:174.9549999>\n[02:55.00]{bg}way',
    );
    expect(parsed.lines.map((line) => line.text)).toEqual(['Come my', 'way']);
  });
});
