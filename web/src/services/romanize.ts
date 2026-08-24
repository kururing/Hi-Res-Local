import { convert as romanizeHangul } from 'hangul-romanization';
import { pinyin } from 'pinyin-pro';
import { toRomaji } from 'wanakana';
import { LyricData } from '../types/lyrics';

const HANGUL_RE = /[\uac00-\ud7af]/u;
const KANA_RE = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const HAN_RE = /\p{Script=Han}/u;
const NON_LATIN_RE = /[\uac00-\ud7af\u3040-\u30ff\u31f0-\u31ff]|\p{Script=Han}/u;
const cache = new Map<string, string | undefined>();

const romanizeSegment = (text: string): string => {
  try {
    if (HANGUL_RE.test(text)) return romanizeHangul(text);
    if (KANA_RE.test(text)) return toRomaji(text);
    if (HAN_RE.test(text)) {
      return pinyin(text, {
        toneType: 'symbol',
        toneSandhi: true,
        nonZh: 'consecutive',
        v: false,
      });
    }
  } catch {
    return text;
  }
  return text;
};

const romanizeMixedText = (text: string): string => {
  if (KANA_RE.test(text) && !HANGUL_RE.test(text)) return romanizeSegment(text);
  if (KANA_RE.test(text)) {
    return text
      .split(/([\uac00-\ud7af]+)/u)
      .map(segment => (NON_LATIN_RE.test(segment) ? romanizeSegment(segment) : segment))
      .join('');
  }
  return text.replace(/[\uac00-\ud7af]+|\p{Script=Han}+/gu, romanizeSegment);
};

const comparable = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase();

export const romanizeText = (text: string): string | undefined => {
  if (cache.has(text)) return cache.get(text);
  if (!NON_LATIN_RE.test(text)) {
    cache.set(text, text);
    return text;
  }

  const candidate = romanizeMixedText(text).trim();
  const result = candidate && !NON_LATIN_RE.test(candidate) && comparable(candidate) !== comparable(text)
    ? candidate
    : undefined;
  cache.set(text, result);
  return result;
};

const timestampTag = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `[${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}]`;
};

export const createRomanizedLrc = (lyrics: LyricData): string | null => {
  if (lyrics.is_synced && lyrics.lines.length > 0) {
    let changed = false;
    const output = lyrics.lines.map(line => {
      const romanized = romanizeText(line.text);
      if (romanized && comparable(romanized) !== comparable(line.text)) changed = true;
      const converted = romanized ?? line.text;
      return `${timestampTag(line.timestamp)}${converted}`;
    });
    return changed ? output.join('\n') : null;
  }

  const source = lyrics.plain_text?.trim();
  if (!source) return null;
  let changed = false;
  const output = source.split(/\r?\n/).map(line => {
    const converted = romanizeText(line);
    if (converted && comparable(converted) !== comparable(line)) changed = true;
    return converted ?? line;
  });
  return changed ? output.join('\n') : null;
};
