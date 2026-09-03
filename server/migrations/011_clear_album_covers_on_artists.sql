-- Artist portraits must not reuse album covers copied during import.
UPDATE artists
SET image_url = NULL,
    updated_at = timezone('utc', now())
WHERE image_url IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM albums
    WHERE albums.primary_artist_id = artists.id
      AND albums.cover_art_url IS NOT NULL
      AND btrim(albums.cover_art_url) = btrim(artists.image_url)
  );
