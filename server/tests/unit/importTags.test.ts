import { describe, expect, it } from 'vitest';
import { classifyAudio } from '../../src/ingestion/classification.js';
import { parseNnpmProbeJson } from '../../src/ingestion/probe.js';
import {
  mapNnpmProbeTags,
  parseReplayGain,
  parseSlashNumber,
  sanitizePublicComment,
  titleFromFilename,
} from '../../src/ingestion/tags.js';
import { detectEmbeddedLyrics } from '../../src/ingestion/embeddedLyrics.js';
import { buildDetectedMetadata } from '../../src/admin/importMetadata.js';
import { UNKNOWN_ALBUM_TITLE, UNKNOWN_ARTIST_NAME } from '../../src/admin/placeholders.js';
import { normalizeCatalogName } from '../../src/catalog/normalize.js';
import { lowercaseTagMap } from '../../src/ingestion/tags.js';

const taggedFlac = JSON.stringify({
  format: {
    format_name: 'flac',
    duration: '180.5',
    bit_rate: '900000',
    tags: { TITLE: 'Night Drive', ARTIST: 'Aurora', ALBUM: 'Glass Harbor', DATE: '2024-05-01' },
  },
  streams: [{
    codec_type: 'audio',
    codec_name: 'flac',
    sample_rate: '96000',
    channels: 2,
    bits_per_raw_sample: '24',
    duration: '180.5',
    tags: { album_artist: 'Aurora Circuit', TRCK: '3/12', TPOS: '1/2' },
  }],
});

describe('nnpm-probe tag mapping', () => {
  it('maps case-insensitive keys and common aliases', () => {
    const tags = mapNnpmProbeTags({
      TIT2: 'Hello',
      tpe1: 'Artist',
      ALBUMARTIST: 'AA',
      TALB: 'Album',
      TCON: 'Jazz',
      TDRC: '1999-01-02',
      TRCK: '4/10',
      TPOS: '2/3',
      TCOM: 'Composer',
      COMM: 'Note',
    });
    expect(tags).toMatchObject({
      title: 'Hello',
      artist: 'Artist',
      albumArtist: 'AA',
      album: 'Album',
      genre: 'Jazz',
      year: 1999,
      track: 4,
      trackTotal: 10,
      disc: 2,
      discTotal: 3,
      composer: 'Composer',
      comment: 'Note',
    });
  });

  it('maps ISRC, UPC, MusicBrainz, BPM, ReplayGain, and label', () => {
    const tags = mapNnpmProbeTags({
      ISRC: 'USAT21702278',
      UPC: '8809519880477',
      MUSICBRAINZ_TRACKID: 'mb-track',
      MUSICBRAINZ_ALBUMID: 'mb-album',
      MUSICBRAINZ_ARTISTID: 'mb-artist',
      BPM: '120',
      LABEL: 'Atlantic',
      REPLAYGAIN_TRACK_GAIN: '-8.12 dB',
      REPLAYGAIN_TRACK_PEAK: '0.98',
    });
    expect(tags.isrc).toBe('USAT21702278');
    expect(tags.upc).toBe('8809519880477');
    expect(tags.musicbrainzTrackId).toBe('mb-track');
    expect(tags.musicbrainzAlbumId).toBe('mb-album');
    expect(tags.musicbrainzArtistId).toBe('mb-artist');
    expect(tags.bpm).toBe(120);
    expect(tags.label).toBe('Atlantic');
    expect(tags.replaygainTrackGain).toBeCloseTo(-8.12);
    expect(tags.replaygainTrackPeak).toBeCloseTo(0.98);
  });

  it('normalizes MusicBrainz URLs and multi-value tags to a single 36-char id', () => {
    const tags = mapNnpmProbeTags({
      MUSICBRAINZ_TRACKID: 'https://musicbrainz.org/recording/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      MUSICBRAINZ_ARTISTID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee / ffffffff-1111-2222-3333-444444444444',
      UFID: 'http://musicbrainz.orgaaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(tags.musicbrainzTrackId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(tags.musicbrainzArtistId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('drops MusicBrainz values that cannot fit the identifier constraint', () => {
    const tags = mapNnpmProbeTags({
      MUSICBRAINZ_ALBUMID: 'not a uuid and way too long '.repeat(8),
    });
    expect(tags.musicbrainzAlbumId).toBeNull();
  });

  it('parses track/disc as current/total', () => {
    expect(parseSlashNumber('1/9')).toEqual({ current: 1, total: 9 });
    expect(parseSlashNumber('2')).toEqual({ current: 2, total: null });
  });

  it('drops comments that look like source URLs', () => {
    expect(sanitizePublicComment('https://tidal.com/track/1')).toBeNull();
    expect(sanitizePublicComment('Studio notes')).toBe('Studio notes');
  });

  it('reads tags from nnpm-probe JSON without trusting filename for artist', () => {
    const probed = parseNnpmProbeJson(taggedFlac);
    expect(probed.tags.title).toBe('Night Drive');
    expect(probed.tags.artist).toBe('Aurora');
    expect(probed.tags.albumArtist).toBe('Aurora Circuit');
    expect(probed.tags.album).toBe('Glass Harbor');
    expect(probed.tags.track).toBe(3);
    expect(probed.hiRes).toBe(true);
    expect(probed.isLossless).toBe(true);
    expect(probed.hasAttachedPicture).toBe(false);
  });

  it('detects an attached picture stream', () => {
    const probed = parseNnpmProbeJson(JSON.stringify({
      format: { format_name: 'flac', duration: '1' },
      streams: [
        { codec_type: 'audio', codec_name: 'flac', sample_rate: '44100', channels: 2, bits_per_raw_sample: '16', duration: '1' },
        { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
      ],
    }));
    expect(probed.hasAttachedPicture).toBe(true);
  });

  it('treats an embedded image video stream as cover art', () => {
    const probed = parseNnpmProbeJson(JSON.stringify({
      format: { format_name: 'flac', duration: '1' },
      streams: [
        { codec_type: 'audio', codec_name: 'flac', sample_rate: '44100', channels: 2, bits_per_raw_sample: '16', duration: '1' },
        { codec_type: 'video', codec_name: 'png' },
      ],
    }));
    expect(probed.hasAttachedPicture).toBe(true);
  });
});

describe('filename title fallback', () => {
  it('uses the basename without guessing artist or album', () => {
    expect(titleFromFilename('Aurora Circuit - Lanterns.flac')).toBe('Aurora Circuit - Lanterns');
    expect(titleFromFilename('path\\Night Drive.wav')).toBe('Night Drive');
  });
});

describe('audio classification', () => {
  it('does not treat CD-quality FLAC as DSD or hi-res', () => {
    expect(classifyAudio({ codec: 'flac', container: 'flac', sampleRateHz: 44_100, bitDepth: 16 })).toEqual({
      lossless: true, hiRes: false, dsd: false, dsdRate: null,
    });
  });

  it('classifies 24-bit/48 kHz lossless as hi-res', () => {
    expect(classifyAudio({ codec: 'flac', container: 'flac', sampleRateHz: 48_000, bitDepth: 24 })).toEqual({
      lossless: true, hiRes: true, dsd: false, dsdRate: null,
    });
  });

  it('classifies lossless, hi-res, and DSD', () => {
    expect(classifyAudio({ codec: 'flac', container: 'flac', sampleRateHz: 96_000, bitDepth: 24 })).toEqual({
      lossless: true, hiRes: true, dsd: false, dsdRate: null,
    });
    expect(classifyAudio({ codec: 'dsd', container: 'dsf', sampleRateHz: 2_822_400, bitDepth: 1 })).toEqual({
      lossless: true, hiRes: true, dsd: true, dsdRate: 64,
    });
    expect(classifyAudio({ codec: 'mp3', container: 'mp3', sampleRateHz: 44_100, bitDepth: null })).toEqual({
      lossless: false, hiRes: false, dsd: false, dsdRate: null,
    });
  });
});

describe('automatic import fallbacks', () => {
  it('fills title from filename and unknown artist/album when tags are missing', () => {
    const probed = parseNnpmProbeJson(JSON.stringify({
      format: { format_name: 'flac', duration: '2' },
      streams: [{ codec_type: 'audio', codec_name: 'flac', sample_rate: '44100', channels: 2, bits_per_raw_sample: '16', duration: '2' }],
    }));
    const detected = buildDetectedMetadata({
      tags: probed.tags,
      probed,
      filename: 'Only Title.flac',
      fileSizeBytes: 100,
    });
    expect(detected.title).toBe('Only Title');
    expect(detected.title_source).toBe('filename');
    expect(detected.artist).toBe(UNKNOWN_ARTIST_NAME);
    expect(detected.album).toBe(UNKNOWN_ALBUM_TITLE);
    expect(detected.album_artist).toBe(UNKNOWN_ARTIST_NAME);
  });

  it('uses album artist when artist is missing', () => {
    const probed = parseNnpmProbeJson(taggedFlac);
    const detected = buildDetectedMetadata({
      tags: { ...probed.tags, artist: null, albumArtist: 'Circuit' },
      probed,
      filename: 'ignored.flac',
      fileSizeBytes: 100,
    });
    expect(detected.artist).toBe('Circuit');
    expect(detected.artist_source).toBe('album_artist');
  });
});

describe('embedded lyrics', () => {
  it('detects synchronized LRC without logging the full text in the matcher', () => {
    const map = lowercaseTagMap({
      LYRICS: '[00:01.00]Hello\n[00:02.00]World',
    });
    const lyrics = detectEmbeddedLyrics(map);
    expect(lyrics?.kind).toBe('synced');
    expect(lyrics?.parsed.lines).toHaveLength(2);
    expect(lyrics?.parsed.lines[0]?.timestamp_seconds).toBeCloseTo(1);
  });

  it('detects plain lyrics', () => {
    const map = lowercaseTagMap({ UNSYNCEDLYRICS: 'Just words' });
    expect(detectEmbeddedLyrics(map)?.kind).toBe('plain');
  });
});

describe('replaygain helper', () => {
  it('parses gain with a dB suffix', () => {
    expect(parseReplayGain('+1.25 dB')).toBeCloseTo(1.25);
  });
});

describe('normalizeCatalogName', () => {
  it('applies Unicode NFC before matching', () => {
    expect(normalizeCatalogName('  Cafe\u0301  ')).toBe(normalizeCatalogName('Café'));
    expect(normalizeCatalogName('  Aurora   Circuit ')).toBe('aurora circuit');
  });
});
