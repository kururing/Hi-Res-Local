/**
 * Lightweight fuzzy search utility with score ranking.
 */

export interface SearchMatchResult<T> {
  item: T;
  score: number;
  matchedFields: string[];
}

export function fuzzySearch<T>(
  items: T[],
  query: string,
  keys: (keyof T | ((item: T) => string | undefined | null))[]
): SearchMatchResult<T>[] {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) {
    return items.map(item => ({ item, score: 1, matchedFields: [] }));
  }

  const queryTerms = cleanQuery.split(/\s+/).filter(Boolean);
  const results: SearchMatchResult<T>[] = [];

  for (const item of items) {
    let totalScore = 0;
    const matchedFields: string[] = [];
    let allTermsMatched = true;

    for (const term of queryTerms) {
      let termMatched = false;
      let maxTermScore = 0;

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        let val: string | undefined | null;
        let fieldName = `field_${i}`;

        if (typeof key === 'function') {
          val = key(item);
          fieldName = key.name || `func_${i}`;
        } else {
          val = String(item[key] ?? '');
          fieldName = String(key);
        }

        if (!val) continue;

        const valLower = val.toLowerCase();
        
        // Exact match
        if (valLower === term) {
          maxTermScore = Math.max(maxTermScore, 100);
          termMatched = true;
          if (!matchedFields.includes(fieldName)) matchedFields.push(fieldName);
        }
        // Starts with
        else if (valLower.startsWith(term)) {
          maxTermScore = Math.max(maxTermScore, 75);
          termMatched = true;
          if (!matchedFields.includes(fieldName)) matchedFields.push(fieldName);
        }
        // Contains substring
        else if (valLower.includes(term)) {
          maxTermScore = Math.max(maxTermScore, 50);
          termMatched = true;
          if (!matchedFields.includes(fieldName)) matchedFields.push(fieldName);
        }
        // Subsequence match
        else {
          let tIdx = 0;
          for (let cIdx = 0; cIdx < valLower.length && tIdx < term.length; cIdx++) {
            if (valLower[cIdx] === term[tIdx]) {
              tIdx++;
            }
          }
          if (tIdx === term.length) {
            maxTermScore = Math.max(maxTermScore, 20);
            termMatched = true;
            if (!matchedFields.includes(fieldName)) matchedFields.push(fieldName);
          }
        }
      }

      if (!termMatched) {
        allTermsMatched = false;
        break;
      }

      totalScore += maxTermScore;
    }

    if (allTermsMatched && totalScore > 0) {
      results.push({ item, score: totalScore, matchedFields });
    }
  }

  // Sort highest score first
  return results.sort((a, b) => b.score - a.score);
}
