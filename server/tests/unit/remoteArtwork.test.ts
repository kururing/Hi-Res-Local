import { describe, expect, it } from 'vitest';
import {
  artworkArtistScore,
  artworkNameScore,
  FakeRemoteArtworkLookup,
  ITunesRemoteArtworkLookup,
  isAllowedArtworkUrl,
  isArtistPortraitUrl,
  isItunesAlbumArtworkUrl,
  parseAppleMusicArtistHtml,
  toLargeArtworkUrl,
} from '../../src/ingestion/remoteArtwork.js';

describe('remote artwork lookup', () => {
  it('rewrites iTunes thumbnail URLs to a large HTTPS square', () => {
    expect(toLargeArtworkUrl('http://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg'))
      .toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/600x600bb.jpg');
    expect(toLargeArtworkUrl('https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/ab/header.png/{w}x{h}{c}.{f}'))
      .toBe('https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/ab/header.png/600x600bb.png');
    expect(isAllowedArtworkUrl('https://is1-ssl.mzstatic.com/image/thumb/Music/cover.jpg')).toBe(true);
    expect(isAllowedArtworkUrl('https://evil.example/cover.jpg')).toBe(false);
    expect(isArtistPortraitUrl('https://is1-ssl.mzstatic.com/image/thumb/Features/artist.jpg')).toBe(true);
    expect(isArtistPortraitUrl('https://is1-ssl.mzstatic.com/image/thumb/AMCArtistImages221/v4/ab/portrait.png/600x600bb.png')).toBe(true);
    expect(isArtistPortraitUrl('https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ab/cd/ef/600x600bb.jpg')).toBe(false);
    expect(isItunesAlbumArtworkUrl('https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/cover.jpg')).toBe(true);
    expect(isItunesAlbumArtworkUrl('https://is1-ssl.mzstatic.com/image/thumb/Features/artist.jpg')).toBe(false);
  });

  it('scores shortened and bilingual artist names', () => {
    expect(artworkNameScore('Invitation', 'Invitation')).toBe(5);
    expect(artworkNameScore('Invitation (Deluxe)', 'Invitation')).toBe(3);
    expect(artworkArtistScore('Hwa Sa', 'Hwasa')).toBe(5);
    expect(artworkNameScore('Red', 'Blue')).toBe(0);
  });

  it('extracts Apple Music JSON-LD and og:image portraits', () => {
    const jsonLd = '<script type="application/ld+json">{"@context":"http://schema.org","@type":"MusicGroup","name":"Ailee","image":"https://is1-ssl.mzstatic.com/image/thumb/Features/a.png/486x486bb.png"}</script>';
    expect(parseAppleMusicArtistHtml(jsonLd)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features/a.png/600x600bb.png',
    );
    const person = '<script type="application/ld+json">{"@type":"Person","image":"https://is1-ssl.mzstatic.com/image/thumb/Features/solo.png/200x200bb.png"}</script>';
    expect(parseAppleMusicArtistHtml(person)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features/solo.png/600x600bb.png',
    );
    const typedArray = '<script type="application/ld+json">{"@type":["Person","MusicGroup"],"image":["https://is1-ssl.mzstatic.com/image/thumb/Features/b.png/200x200bb.png"]}</script>';
    expect(parseAppleMusicArtistHtml(typedArray)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features/b.png/600x600bb.png',
    );
    const og = '<meta content="https://is1-ssl.mzstatic.com/image/thumb/Features/og.jpg?a=1&amp;b=2" property="og:image">';
    expect(parseAppleMusicArtistHtml(og)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features/og.jpg?a=1&b=2',
    );
    const imageObject = '<script type="application/ld+json">{"@type":"MusicGroup","image":{"@type":"ImageObject","url":"https://is1-ssl.mzstatic.com/image/thumb/Features/obj.png/200x200bb.png"}}</script>';
    expect(parseAppleMusicArtistHtml(imageObject)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features/obj.png/600x600bb.png',
    );
    const musicPath = '<script type="application/ld+json">{"@type":"MusicGroup","image":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ab/cd/ef/200x200bb.jpg"}</script>';
    expect(parseAppleMusicArtistHtml(musicPath)).toBeNull();
    const albumOg = '<meta content="https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg" property="og:image">';
    expect(parseAppleMusicArtistHtml(albumOg)).toBeNull();
    const musicThenPortrait = [
      musicPath,
      '<meta content="https://is1-ssl.mzstatic.com/image/thumb/Features/og.jpg" property="og:image">',
    ].join('');
    expect(parseAppleMusicArtistHtml(musicThenPortrait)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features/og.jpg',
    );
    const header = '<script id="serialized-server-data" type="application/json">[{"data":{"sections":[{"items":[{"id":"artist-detail-header - 1","artwork":{"dictionary":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/ab/header.png/{w}x{h}{c}.{f}"}}},{"id":"track-lockup - 1 - 2","artwork":{"dictionary":{"url":"https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/cover.jpg/{w}x{h}{c}.{f}"}}}]}]}}]</script>';
    expect(parseAppleMusicArtistHtml(header)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/ab/header.png/600x600bb.png',
    );
  });

  it('selects a matching iTunes album cover from search results', async () => {
    const lookup = new ITunesRemoteArtworkLookup(async (url) => {
      const href = String(url);
      if (href.includes('itunes.apple.com/search')) {
        return jsonResponse({
          results: [{
            artistName: 'Ailee',
            collectionName: 'Invitation',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg',
          }],
        });
      }
      return new Response('not found', { status: 404 });
    });
    await expect(lookup.lookupAlbumCover('Ailee', 'Invitation')).resolves.toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Music/600x600bb.jpg',
    );
  });

  it('returns Apple Music artist HTML and never uses album artwork', async () => {
    const lookup = new ITunesRemoteArtworkLookup(async (url) => {
      const href = String(url);
      if (href.includes('itunes.apple.com/search')) {
        return jsonResponse({
          results: [{ artistId: 424242, artistName: 'Ailee', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg' }],
        });
      }
      if (href.includes('music.apple.com/vn/artist/424242')) {
        return new Response(
          '<script type="application/ld+json">{"@type":"MusicGroup","image":"https://is1-ssl.mzstatic.com/image/thumb/Features/p.png/200x200bb.png"}</script>',
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });
    await expect(lookup.lookupArtistPortrait('Ailee')).resolves.toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features/p.png/600x600bb.png',
    );
  });

  it('uses an album title hint to find the artist, then stores the portrait', async () => {
    const lookup = new ITunesRemoteArtworkLookup(async (url) => {
      const href = String(url);
      if (href.includes('itunes.apple.com/search') && href.includes('entity=album')) {
        return jsonResponse({
          results: [{
            artistId: 99,
            artistName: 'Ailee',
            collectionName: 'Invitation',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg',
          }],
        });
      }
      if (href.includes('itunes.apple.com/search')) {
        return jsonResponse({ results: [] });
      }
      if (href.includes('music.apple.com') && href.includes('/99')) {
        return new Response(
          '<script type="application/ld+json">{"@type":"MusicGroup","image":"https://is1-ssl.mzstatic.com/image/thumb/Features/ailee.png/200x200bb.png"}</script>',
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });
    await expect(lookup.lookupArtistPortrait('Ailee', 'Invitation')).resolves.toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features/ailee.png/600x600bb.png',
    );
  });

  it('finds an artist from album search when the musicArtist catalog has no hit', async () => {
    const lookup = new ITunesRemoteArtworkLookup(async (url) => {
      const href = String(url);
      if (href.includes('itunes.apple.com/search') && href.includes('entity=album')) {
        return jsonResponse({
          results: [{
            artistId: 77,
            artistName: 'Aurora Circuit',
            collectionName: 'Glass Harbor',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/glass.jpg',
          }],
        });
      }
      if (href.includes('itunes.apple.com/search')) {
        return jsonResponse({ results: [] });
      }
      if (href.includes('music.apple.com') && href.includes('/77')) {
        return new Response(
          '<script type="application/ld+json">{"@type":"MusicGroup","image":"https://is1-ssl.mzstatic.com/image/thumb/Features/circuit.png/200x200bb.png"}</script>',
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });
    await expect(lookup.lookupArtistPortrait('Aurora Circuit')).resolves.toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Features/circuit.png/600x600bb.png',
    );
  });

  it('returns null when Apple Music HTML is missing instead of using the album cover', async () => {
    const lookup = new ITunesRemoteArtworkLookup(async (url) => {
      const href = String(url);
      if (href.includes('itunes.apple.com/search') && href.includes('entity=album')) {
        return jsonResponse({
          results: [{
            artistId: 55,
            artistName: 'Charlie Puth',
            collectionName: 'Attention - Single',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg',
          }],
        });
      }
      return new Response('not found', { status: 404 });
    });
    await expect(lookup.lookupArtistPortrait('Charlie Puth', 'Attention')).resolves.toBeNull();
  });

  it('ignores Apple Music og:image when it is an album cover', async () => {
    const lookup = new ITunesRemoteArtworkLookup(async (url) => {
      const href = String(url);
      if (href.includes('itunes.apple.com/search')) {
        return jsonResponse({
          results: [{ artistId: 88, artistName: 'Echo' }],
        });
      }
      if (href.includes('music.apple.com')) {
        return new Response(
          '<meta property="og:image" content="https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg">',
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });
    await expect(lookup.lookupArtistPortrait('Echo')).resolves.toBeNull();
  });

  it('returns null when iTunes is unreachable instead of throwing', async () => {
    const lookup = new ITunesRemoteArtworkLookup(async () => {
      throw new Error('network down');
    });
    await expect(lookup.lookupAlbumCover('Ailee', 'Invitation')).resolves.toBeNull();
  });

  it('records fake lookup calls for tests', async () => {
    const fake = new FakeRemoteArtworkLookup();
    await expect(fake.lookupAlbumCover('Ailee', 'Invitation')).resolves.toContain('mzstatic.com');
    expect(fake.calls).toEqual([{ kind: 'album', artist: 'Ailee', album: 'Invitation' }]);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
