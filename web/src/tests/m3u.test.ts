import { describe, it, expect } from 'vitest';
import { parseM3u, generateM3u } from '../services/m3u';
import { Track } from '../types/library';
import { Playlist } from '../types/playlist';

describe('M3U Playlist Parser & Exporter', () => {
  const sampleM3u = `#EXTM3U
#PLAYLIST:Rock Classics
#EXTINF:354,Queen - Bohemian Rhapsody
D:/Music/Rock/Queen/Bohemian_Rhapsody.flac
#EXTINF:219,Queen - Love of My Life
D:/Music/Rock/Queen/Love_of_My_Life.mp3
`;

  it('parses extended M3U entries', () => {
    const entries = parseM3u(sampleM3u);
    expect(entries.length).toBe(2);
    expect(entries[0].title).toBe('Bohemian Rhapsody');
    expect(entries[0].artist).toBe('Queen');
    expect(entries[0].duration).toBe(354);
    expect(entries[0].path).toBe('D:/Music/Rock/Queen/Bohemian_Rhapsody.flac');

    expect(entries[1].title).toBe('Love of My Life');
    expect(entries[1].artist).toBe('Queen');
    expect(entries[1].duration).toBe(219);
  });

  it('exports playlist to formatted M3U string', () => {
    const playlist: Playlist = {
      id: 'pl-1',
      name: 'My Test Playlist',
      description: 'A great collection',
      track_ids: ['t1'],
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };

    const tracks: Track[] = [
      {
        id: 't1',
        title: 'Song Title',
        artist: 'Artist Name',
        album: 'Album Name',
        duration: 200,
        path: 'C:/Music/test.flac',
        date_added: '2025-01-01',
      },
    ];

    const output = generateM3u(playlist, tracks);
    expect(output).toContain('#EXTM3U');
    expect(output).toContain('#PLAYLIST:My Test Playlist');
    expect(output).toContain('#EXTINF:200,Artist Name - Song Title');
    expect(output).toContain('C:/Music/test.flac');
  });
});
