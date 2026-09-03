CREATE TABLE user_library_tracks (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE library_changes (
  change_id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT library_changes_entity_type_check CHECK (entity_type IN ('track')),
  CONSTRAINT library_changes_operation_check CHECK (operation IN ('upsert', 'delete'))
);

CREATE INDEX idx_user_library_tracks_user_created ON user_library_tracks (user_id, created_at DESC);
CREATE INDEX idx_user_library_tracks_track_id ON user_library_tracks (track_id);
CREATE INDEX idx_library_changes_user_cursor ON library_changes (user_id, change_id);
