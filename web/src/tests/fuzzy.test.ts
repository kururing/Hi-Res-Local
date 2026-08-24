import { describe, it, expect } from 'vitest';
import { fuzzySearch } from '../services/fuzzy';

describe('Fuzzy Search Matcher', () => {
  const items = [
    { title: 'Bohemian Rhapsody', artist: 'Queen', genre: 'Rock' },
    { title: 'Nắng Ấm Xa Dần', artist: 'Sơn Tùng M-TP', genre: 'V-Pop' },
    { title: 'Hotel California', artist: 'Eagles', genre: 'Acoustic Rock' },
    { title: 'Clair de Lune', artist: 'Claude Debussy', genre: 'Classical' },
  ];

  it('matches exact and substring terms', () => {
    const results = fuzzySearch(items, 'Bohemian', ['title', 'artist']);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.title).toBe('Bohemian Rhapsody');
    expect(results[0].score).toBeGreaterThan(50);
  });

  it('matches artist and genre fields', () => {
    const results = fuzzySearch(items, 'Debussy', ['title', 'artist']);
    expect(results.length).toBe(1);
    expect(results[0].item.title).toBe('Clair de Lune');

    const rockResults = fuzzySearch(items, 'Rock', ['title', 'artist', 'genre']);
    expect(rockResults.length).toBe(2);
  });

  it('ranks higher match scores first', () => {
    const results = fuzzySearch(items, 'Cal', ['title', 'genre']);
    expect(results.length).toBe(2);
    // Hotel California starts with Cal or contains Cal
    expect(results[0].item.title).toBe('Hotel California');
  });

  it('matches Vietnamese text without requiring diacritics', () => {
    expect(fuzzySearch(items, 'nang am', ['title', 'artist'])[0].item.title).toBe('Nắng Ấm Xa Dần');
  });

  it('tolerates a small typo and supports initials', () => {
    expect(fuzzySearch(items, 'bohemain', ['title'])[0].item.title).toBe('Bohemian Rhapsody');
    expect(fuzzySearch(items, 'st', ['artist'])[0].item.artist).toBe('Sơn Tùng M-TP');
  });

  it('does not return every item for an unrelated single letter', () => {
    expect(fuzzySearch(items, 'q', ['title', 'artist']).map(result => result.item.artist)).toEqual(['Queen']);
  });
});
