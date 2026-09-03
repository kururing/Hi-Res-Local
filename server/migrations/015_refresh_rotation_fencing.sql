WITH compromised_families AS (
  SELECT parent.family_id
  FROM refresh_sessions AS child
  JOIN refresh_sessions AS parent ON parent.id = child.parent_session_id
  WHERE child.revoked_at IS NULL
  GROUP BY child.parent_session_id, parent.family_id
  HAVING count(*) > 1
)
UPDATE refresh_sessions
SET revoked_at = COALESCE(revoked_at, timezone('utc', now())),
    reuse_detected_at = COALESCE(reuse_detected_at, timezone('utc', now()))
WHERE family_id IN (SELECT family_id FROM compromised_families);

CREATE UNIQUE INDEX idx_refresh_sessions_single_active_child
  ON refresh_sessions (parent_session_id)
  WHERE parent_session_id IS NOT NULL AND revoked_at IS NULL;
