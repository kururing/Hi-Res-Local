import { describe, expect, it } from 'vitest';
import { createRomanizedLrc, romanizeText } from '../services/romanize';

describe('local romanization', () => {
  it('romanizes Korean and suppresses unchanged Latin text', () => {
    expect(romanizeText('사랑해')).toMatch(/sarang/i);
    expect(romanizeText('Hello')).toBe('Hello');
  });

  it('romanizes mixed Chinese and Korean scripts', () => {
    const output = romanizeText('我爱你 사랑해');
    expect(output).toMatch(/wǒ/i);
    expect(output).toMatch(/sarang/i);
  });

  it('keeps timestamps when generating companion LRC', () => {
    const lrc = createRomanizedLrc({
      lines: [{ timestamp: 3.25, text: '사랑해' }],
      is_synced: true,
    });
    expect(lrc).toMatch(/^\[00:03\.25\]/);
    expect(lrc).toMatch(/sarang/i);
  });

  it('does not create a duplicate companion for Latin-only lyrics', () => {
    expect(
      createRomanizedLrc({
        lines: [{ timestamp: 1, text: 'Hello' }],
        is_synced: true,
      })
    ).toBeNull();
  });
});
