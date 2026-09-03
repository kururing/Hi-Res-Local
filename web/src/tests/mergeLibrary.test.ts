import { describe, expect, it } from 'vitest';
import {
  isCloudPlayback,
  mergeLocalAndCloudTracks,
  metadataMergeKey,
  statsFromTracks,
} from '../platform/hybrid/mergeLibrary';
import type { Track } from '../types/library';

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'local-1',
    title: 'Light',
    artist: 'Wanna One',
    album: '1÷x=1',
    duration: 183,
    path: 'D:/Music/Light.flac',
    date_added: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('mergeLocalAndCloudTracks', () => {
  it('keeps the local filesystem path when metadata matches', () => {
    const local = sampleTrack();
    const cloud = sampleTrack({
      id: '11111111-1111-4111-8111-111111111111',
      path: '',
      duration: 184,
      is_favorite: true,
    });
    const merged = mergeLocalAndCloudTracks([local], [cloud]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.path).toBe('D:/Music/Light.flac');
    expect(merged[0]?.source).toBe('local_and_cloud');
    expect(merged[0]?.cloudTrackId).toBe(cloud.id);
    expect(merged[0]?.is_favorite).toBe(true);
    expect(JSON.stringify(merged)).not.toMatch(/storage_key|storageKey/);
  });

  it('appends unmatched catalog tracks as cloud-only without a filesystem path', () => {
    const local = sampleTrack({ title: 'Local Only' });
    const cloud = sampleTrack({
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Cloud Only',
      path: 'https://cdn.example.test/secret.flac',
    });
    const merged = mergeLocalAndCloudTracks([local], [cloud]);
    expect(merged).toHaveLength(2);
    const cloudOnly = merged.find(track => track.source === 'cloud');
    expect(cloudOnly?.path).toBe('');
    expect(cloudOnly?.id).toBe(cloud.id);
    expect(cloudOnly?.cloudTrackId).toBe(cloud.id);
    expect(isCloudPlayback(cloudOnly!)).toBe(true);
    expect(isCloudPlayback(merged.find(track => track.source === 'local')!)).toBe(false);
  });

  it('merges on checksum even when titles differ', () => {
    const checksum = 'ab'.repeat(32);
    const merged = mergeLocalAndCloudTracks(
      [sampleTrack({ title: 'File Name', checksum_sha256: checksum })],
      [sampleTrack({
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Official Title',
        path: '',
        checksum_sha256: checksum,
      })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe('local_and_cloud');
    expect(merged[0]?.cloudTrackId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('merges on ISRC and MusicBrainz id before metadata', () => {
    const byIsrc = mergeLocalAndCloudTracks(
      [sampleTrack({ title: 'Local', isrc: 'USAT21702278' })],
      [sampleTrack({
        id: 'isrc-cloud',
        title: 'Catalog',
        path: '',
        isrc: 'usat21702278',
      })],
    );
    expect(byIsrc).toHaveLength(1);
    expect(byIsrc[0]?.source).toBe('local_and_cloud');

    const byMbid = mergeLocalAndCloudTracks(
      [sampleTrack({ title: 'Local', musicbrainz_track_id: 'AAAAaaaa-1111-4111-8111-111111111111' })],
      [sampleTrack({
        id: 'mb-cloud',
        title: 'Catalog',
        path: '',
        musicbrainz_track_id: 'aaaaaaaa-1111-4111-8111-111111111111',
      })],
    );
    expect(byMbid).toHaveLength(1);
    expect(byMbid[0]?.source).toBe('local_and_cloud');
  });

  it('does not metadata-merge recordings with conflicting identifiers', () => {
    const merged = mergeLocalAndCloudTracks(
      [sampleTrack({ isrc: 'USAT21702278' })],
      [sampleTrack({ id: 'other', path: '', isrc: 'GBUM71800001' })],
    );
    expect(merged).toHaveLength(2);
  });

  it('does not merge near-miss titles', () => {
    const merged = mergeLocalAndCloudTracks(
      [sampleTrack({ title: 'Light' })],
      [sampleTrack({ id: 'cloud', title: 'Lights', path: '' })],
    );
    expect(merged).toHaveLength(2);
    expect(metadataMergeKey(merged[0]!)).not.toBe(metadataMergeKey(merged[1]!));
  });

  it('rebuilds stats from the merged set', () => {
    const stats = statsFromTracks([
      sampleTrack(),
      sampleTrack({ id: '2', artist: 'Other', album: 'B' }),
    ]);
    expect(stats.total_tracks).toBe(2);
    expect(stats.total_artists).toBe(2);
    expect(stats.total_albums).toBe(2);
    expect(stats.total_duration_secs).toBe(366);
  });
});
