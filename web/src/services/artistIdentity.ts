const PARENTHETICAL_ARTIST = /[（(]([^()（）]+)[)）]/g;

export const normalizeArtistIdentity = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .trim();

const hasLatinLetters = (value: string) => /\p{Script=Latin}/u.test(value);
const hasNonLatinLetters = (value: string) => /\p{L}/u.test(value) && !hasLatinLetters(value);

/**
 * Parentheses in music metadata commonly contain qualifiers (feat., live,
 * remix), not aliases. Only infer an alias for a single cross-script pair;
 * this covers bilingual names such as `아이오아이 (I.O.I)` without merging
 * unrelated credits such as `IU (feat. SUGA)`.
 */
const hasVerifiableParentheticalAlias = (base: string, alias: string) => {
  const baseHasLatin = hasLatinLetters(base);
  const aliasHasLatin = hasLatinLetters(alias);
  const baseHasNonLatin = hasNonLatinLetters(base);
  const aliasHasNonLatin = hasNonLatinLetters(alias);
  return (baseHasLatin && aliasHasNonLatin) || (baseHasNonLatin && aliasHasLatin);
};

export const artistIdentityKeys = (value: string): string[] => {
  const keys = new Set<string>();
  const add = (part: string) => {
    const normalized = normalizeArtistIdentity(part);
    if (normalized.length >= 2) keys.add(normalized);
  };

  add(value);
  const matches = [...value.matchAll(PARENTHETICAL_ARTIST)];
  if (matches.length === 1) {
    const alias = matches[0][1];
    const base = value.replace(PARENTHETICAL_ARTIST, ' ');
    if (hasVerifiableParentheticalAlias(base, alias)) {
      add(base);
      add(alias);
    }
  }
  return [...keys];
};

export const artistsShareIdentity = (left: string, right: string): boolean => {
  const rightKeys = new Set(artistIdentityKeys(right));
  return artistIdentityKeys(left).some(key => rightKeys.has(key));
};
