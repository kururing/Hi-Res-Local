import { describe, expect, it } from 'vitest';
import { artistIdentityKeys, artistsShareIdentity, normalizeArtistIdentity } from '../services/artistIdentity';

describe('artist identity keys', () => {
  it('links bilingual artist names', () => {
    const keys = artistIdentityKeys('아이오아이 (I.O.I)');
    expect(keys).toContain(normalizeArtistIdentity('아이오아이'));
    expect(keys).toContain('ioi');
  });

  it('does not treat featured credits as aliases', () => {
    expect(artistIdentityKeys('IU (feat. SUGA)')).toEqual(['iufeatsuga']);
  });

  it('does not treat live/remix qualifiers as aliases', () => {
    expect(artistIdentityKeys('Artist (Live)')).toEqual(['artistlive']);
  });

  it('matches a bilingual display name to either metadata spelling', () => {
    expect(artistsShareIdentity('I.O.I', '아이오아이 (I.O.I)')).toBe(true);
    expect(artistsShareIdentity('아이오아이', '아이오아이 (I.O.I)')).toBe(true);
  });

  it('matches artist names that differ only by separators', () => {
    expect(artistsShareIdentity('Hwa Sa', 'Hwasa')).toBe(true);
    expect(artistsShareIdentity('Hwa-Sa', 'HWASA')).toBe(true);
  });

  it('does not merge unrelated featured artists', () => {
    expect(artistsShareIdentity('IU', 'IU (feat. SUGA)')).toBe(false);
  });
});
