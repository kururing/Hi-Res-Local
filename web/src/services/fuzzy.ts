/** Accent-insensitive, typo-tolerant fuzzy search with score ranking. */
export interface SearchMatchResult<T> {
  item: T;
  score: number;
  matchedFields: string[];
}

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const editDistance = (left: string, right: string): number => {
  if (left === right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length];
};

const scoreTerm = (term: string, value: string): number => {
  if (!value) return 0;
  const words = value.split(/\s+/).filter(Boolean);
  if (value === term) return 120;
  if (value.startsWith(term)) return 105;
  if (words.some(word => word === term)) return 100;
  if (words.some(word => word.startsWith(term))) return 88;
  if (term.length > 1 && value.includes(term)) return 72;
  const initials = words.map(word => word[0]).join('');
  if (term.length > 1 && initials.startsWith(term)) return 68;

  if (term.length >= 3) {
    const allowed = Math.max(1, Math.floor(term.length * 0.3));
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const word of words) {
      if (Math.abs(word.length - term.length) <= allowed) {
        bestDistance = Math.min(bestDistance, editDistance(term, word));
      }
    }
    if (bestDistance <= allowed) return 58 - bestDistance * 8;

    let queryIndex = 0;
    let firstIndex = -1;
    let lastIndex = -1;
    for (let i = 0; i < value.length && queryIndex < term.length; i++) {
      if (value[i] === term[queryIndex]) {
        if (firstIndex < 0) firstIndex = i;
        lastIndex = i;
        queryIndex++;
      }
    }
    if (queryIndex === term.length) {
      const density = term.length / Math.max(term.length, lastIndex - firstIndex + 1);
      if (density >= 0.55) return 30 + density * 18;
    }
  }
  return 0;
};

export function fuzzySearch<T>(
  items: T[], query: string,
  keys: (keyof T | ((item: T) => string | undefined | null))[]
): SearchMatchResult<T>[] {
  const cleanQuery = normalize(query);
  if (!cleanQuery) return items.map(item => ({ item, score: 1, matchedFields: [] }));
  const queryTerms = cleanQuery.split(/\s+/).filter(Boolean);

  return items.map(item => {
    const fields = keys.map((key, index) => ({
      name: typeof key === 'function' ? key.name || `func_${index}` : String(key),
      value: normalize(String(typeof key === 'function' ? key(item) ?? '' : item[key] ?? '')),
    }));
    const matchedFields = new Set<string>();
    let score = 0;
    for (const term of queryTerms) {
      let best = 0;
      let bestField = '';
      for (const field of fields) {
        const candidate = scoreTerm(term, field.value);
        if (candidate > best) { best = candidate; bestField = field.name; }
      }
      if (!best) return null;
      score += best;
      matchedFields.add(bestField);
    }
    for (const field of fields) score += scoreTerm(cleanQuery, field.value) * 0.35;
    return { item, score, matchedFields: [...matchedFields] };
  }).filter((result): result is SearchMatchResult<T> => result !== null)
    .sort((a, b) => b.score - a.score);
}
