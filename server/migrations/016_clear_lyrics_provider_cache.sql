-- Re-resolve LRCLIB/provider lyrics after ranking changed
-- (synchronized first, then track language). Keep embedded ingestion lyrics.
DELETE FROM track_lyrics
WHERE provider IS DISTINCT FROM 'embedded';
