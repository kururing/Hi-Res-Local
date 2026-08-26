import { convert as romanizeHangul } from 'hangul-romanization';
import { pinyin } from 'pinyin-pro';
import { toRomaji } from 'wanakana';
import { LyricData } from '../types/lyrics';

const HANGUL_RE = /[\uac00-\ud7af]/u;
const KANA_RE = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const HAN_RE = /\p{Script=Han}/u;
const cache = new Map<string, string | undefined>();
const asyncCache = new Map<string, Promise<string | undefined>>();
interface JapaneseRomanizer {
  converter: import('kuroshiro').default;
  analyzer: import('kuroshiro-analyzer-kuromoji').default;
}

let japaneseRomanizerPromise: Promise<JapaneseRomanizer> | undefined;
let universalTransliteratorPromise: Promise<typeof import('any-ascii').default> | undefined;

export const japaneseDictionaryPath = (basePath: string): string => {
  const normalizedBase = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return `${normalizedBase.replace(/\/?$/u, '/')}kuromoji-dict/`;
};

export const japaneseDictionaryPathFromBaseUri = (baseUri: string): string =>
  japaneseDictionaryPath(new URL('.', baseUri).pathname);

const getJapaneseRomanizer = async (): Promise<JapaneseRomanizer> => {
  if (!japaneseRomanizerPromise) {
    japaneseRomanizerPromise = Promise.all([
      import('kuroshiro'),
      import('kuroshiro-analyzer-kuromoji'),
    ]).then(async ([{ default: Kuroshiro }, { default: KuromojiAnalyzer }]) => {
      const converter = new Kuroshiro();
      const dictPath = typeof document === 'undefined'
        ? undefined
        : japaneseDictionaryPathFromBaseUri(document.baseURI);
      const analyzer = new KuromojiAnalyzer({ dictPath });
      await converter.init(analyzer);
      return { converter, analyzer };
    }).catch(error => {
      // Allow a later attempt after a transient asset-loading failure.
      japaneseRomanizerPromise = undefined;
      throw error;
    });
  }
  return japaneseRomanizerPromise;
};

const isLikelyJapaneseKanji = async (
  text: string,
  analyzer: import('kuroshiro-analyzer-kuromoji').default
): Promise<boolean> => {
  const tokens = await analyzer.parse(text);
  let totalHanCharacters = 0;
  let recognizedHanCharacters = 0;

  for (const token of tokens) {
    const hanCharacters = [...token.surface_form].filter(character => HAN_RE.test(character)).length;
    totalHanCharacters += hanCharacters;
    if (hanCharacters > 0 && token.reading && token.reading !== '*') {
      recognizedHanCharacters += hanCharacters;
    }
  }

  return totalHanCharacters > 0 && recognizedHanCharacters / totalHanCharacters >= 0.75;
};

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
      .map(segment => (containsNonLatinLetters(segment) ? romanizeSegment(segment) : segment))
      .join('');
  }
  return text.replace(/[\uac00-\ud7af]+|\p{Script=Han}+/gu, romanizeSegment);
};

export const containsNonLatinLetters = (text: string): boolean =>
  [...text].some(character => /\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character));

const transliterateRemainingScripts = async (text: string): Promise<string> => {
  if (!containsNonLatinLetters(text)) return text;
  universalTransliteratorPromise ??= import('any-ascii').then(module => module.default);
  const anyAscii = await universalTransliteratorPromise;
  return text.replace(/[\p{L}\p{M}]+/gu, segment =>
    containsNonLatinLetters(segment) ? anyAscii(segment) : segment
  );
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
  if (!containsNonLatinLetters(text)) {
    cache.set(text, text);
    return text;
  }

  const candidate = romanizeMixedText(text).trim();
  const result = candidate && !containsNonLatinLetters(candidate) && comparable(candidate) !== comparable(text)
    ? candidate
    : undefined;
  cache.set(text, result);
  return result;
};

/** Uses a local Japanese morphological dictionary for mixed kana + kanji lines. */
export const romanizeTextAsync = (
  text: string,
  preferJapaneseReadings = false
): Promise<string | undefined> => {
  const cacheKey = `${preferJapaneseReadings ? 'ja' : 'auto'}:${text}`;
  const cached = asyncCache.get(cacheKey);
  if (cached) return cached;

  const conversion = (async () => {
    let candidate = text;
    if ((preferJapaneseReadings || KANA_RE.test(text)) && (KANA_RE.test(text) || HAN_RE.test(text))) {
      try {
        const { converter, analyzer } = await getJapaneseRomanizer();
        const useJapaneseReading = KANA_RE.test(text) || await isLikelyJapaneseKanji(text, analyzer);
        if (useJapaneseReading) {
          candidate = (await converter.convert(text, {
            to: 'romaji',
            mode: 'spaced',
            romajiSystem: 'hepburn',
          })).trim();
        }
      } catch (error) {
        console.warn('Japanese kanji romanization is unavailable', error);
      }
    }

    candidate = romanizeMixedText(candidate).trim();
    candidate = (await transliterateRemainingScripts(candidate)).trim();
    return candidate && !containsNonLatinLetters(candidate) && comparable(candidate) !== comparable(text)
      ? candidate.replace(/\s+/gu, ' ')
      : undefined;
  })();

  asyncCache.set(cacheKey, conversion);
  return conversion;
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

export const createRomanizedLrcAsync = async (lyrics: LyricData): Promise<string | null> => {
  const sourceText = lyrics.lines.length > 0
    ? lyrics.lines.map(line => line.text).join('\n')
    : lyrics.plain_text ?? '';
  const preferJapaneseReadings = KANA_RE.test(sourceText);

  if (lyrics.is_synced && lyrics.lines.length > 0) {
    let changed = false;
    const output: string[] = [];
    for (const line of lyrics.lines) {
      const romanized = await romanizeTextAsync(line.text, preferJapaneseReadings);
      if (romanized && comparable(romanized) !== comparable(line.text)) changed = true;
      output.push(`${timestampTag(line.timestamp)}${romanized ?? line.text}`);
    }
    return changed ? output.join('\n') : null;
  }

  const source = lyrics.plain_text?.trim();
  if (!source) return null;
  let changed = false;
  const output: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const romanized = await romanizeTextAsync(line, preferJapaneseReadings);
    if (romanized && comparable(romanized) !== comparable(line)) changed = true;
    output.push(romanized ?? line);
  }
  return changed ? output.join('\n') : null;
};
