import { describe, expect, it } from 'vitest';
import { computePublishBlockers } from '../../src/admin/catalogService.js';

const track = {
  id: 't',
  title: 'Lanterns',
  album_id: 'a',
  album_title: 'Harbor',
  track_number: 1,
  disc_number: 1,
  duration_seconds: 10,
  genre: 'Electronic',
  available: false,
  publication_state: 'draft' as const,
  deleted_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('publish blockers', () => {
  it('requires a ready asset, artist, album, and rights attestation', () => {
    expect(computePublishBlockers({
      track,
      artists: [],
      albumId: null,
      hasReadyAsset: false,
      rights: null,
      blockingJob: true,
      artworkRequired: false,
      hasArtwork: false,
    })).toEqual([
      'artist_required',
      'album_required',
      'audio_asset_not_ready',
      'rights_attestation_required',
      'ingestion_not_ready',
    ]);
  });

  it('allows publish when required gates pass and artwork is optional', () => {
    expect(computePublishBlockers({
      track,
      artists: [{ id: 'ar' }],
      albumId: 'a',
      hasReadyAsset: true,
      rights: {
        track_id: 't',
        rights_holder: 'Demo',
        license_source_ref: 'synthetic-fixture',
        territory_scope: null,
        attested: true,
        attested_by: 'u',
        attested_at: new Date(),
      },
      blockingJob: false,
      artworkRequired: false,
      hasArtwork: false,
    })).toEqual([]);
  });
});
