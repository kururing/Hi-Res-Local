-- LRCLIB may gain synchronized lyrics after a plain-only result was cached.
-- Expire legacy plain-only provider rows once so the next resolve upgrades them.
UPDATE track_lyrics
SET expires_at = timezone('utc', now())
WHERE provider = 'lrclib'
  AND status = 'found'
  AND is_synced = FALSE;
