use chrono::Utc;
use rusqlite::{params, Connection};

use crate::db::queries_tracks::map_row_to_track;
use crate::error::{AppError, AppResult};
use crate::models::album::{AlbumDetail, AlbumSummary};
use crate::models::artist::{ArtistDetail, ArtistSummary};
use crate::models::browse::HomeFeed;
use crate::models::genre::GenreSummary;
use crate::models::settings::LibraryRoot;

pub fn add_library_root(conn: &Connection, path: &str, name: &str) -> AppResult<LibraryRoot> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        r#"
        INSERT INTO library_roots (id, path, name, is_active, last_scanned_at, created_at)
        VALUES (?1, ?2, ?3, 1, NULL, ?4)
        ON CONFLICT(path) DO UPDATE SET is_active = 1, name = excluded.name;
        "#,
        params![id, path, name, now],
    )?;

    get_library_root_by_path(conn, path)?
        .ok_or_else(|| AppError::Internal("Failed to insert library root".to_string()))
}

pub fn get_library_root_by_path(conn: &Connection, path: &str) -> AppResult<Option<LibraryRoot>> {
    let mut stmt = conn.prepare("SELECT * FROM library_roots WHERE path = ?1")?;
    let mut rows = stmt.query(params![path])?;
    if let Some(row) = rows.next()? {
        Ok(Some(LibraryRoot {
            id: row.get("id")?,
            path: row.get("path")?,
            name: row.get("name")?,
            is_active: row.get::<_, i32>("is_active")? != 0,
            last_scanned_at: row.get("last_scanned_at")?,
            created_at: row.get("created_at")?,
        }))
    } else {
        Ok(None)
    }
}

pub fn get_library_roots(conn: &Connection) -> AppResult<Vec<LibraryRoot>> {
    let mut stmt = conn.prepare("SELECT * FROM library_roots ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], |row| {
        Ok(LibraryRoot {
            id: row.get("id")?,
            path: row.get("path")?,
            name: row.get("name")?,
            is_active: row.get::<_, i32>("is_active")? != 0,
            last_scanned_at: row.get("last_scanned_at")?,
            created_at: row.get("created_at")?,
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn remove_library_root(conn: &Connection, id: &str) -> AppResult<bool> {
    let rows = conn.execute("DELETE FROM library_roots WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn update_root_scanned_at(conn: &Connection, path: &str) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE library_roots SET last_scanned_at = ?1 WHERE path = ?2",
        params![now, path],
    )?;
    Ok(())
}

pub fn set_root_active(conn: &Connection, id: &str, is_active: bool) -> AppResult<()> {
    let val = if is_active { 1 } else { 0 };
    conn.execute(
        "UPDATE library_roots SET is_active = ?1 WHERE id = ?2",
        params![val, id],
    )?;
    Ok(())
}

pub fn get_artists(conn: &Connection) -> AppResult<Vec<ArtistSummary>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            COALESCE(NULLIF(album_artist, ''), artist) AS artist_name,
            COUNT(DISTINCT album) AS album_count,
            COUNT(id) AS track_count,
            SUM(duration_ms) AS total_duration_ms,
            MAX(cover_art_path) AS cover_art_path,
            EXISTS(SELECT 1 FROM favorite_artists fa WHERE fa.artist_name = COALESCE(NULLIF(tracks.album_artist, ''), tracks.artist) COLLATE NOCASE) AS is_fav
        FROM tracks
        WHERE is_corrupt = 0
        GROUP BY artist_name COLLATE NOCASE
        ORDER BY artist_name COLLATE NOCASE ASC
        "#,
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ArtistSummary {
            name: row.get(0)?,
            album_count: row.get::<_, i64>(1)? as u32,
            track_count: row.get::<_, i64>(2)? as u32,
            total_duration_ms: row.get::<_, Option<i64>>(3)?.unwrap_or(0) as u64,
            cover_art_path: row.get(4)?,
            is_favorite: row.get::<_, i32>(5)? != 0,
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn get_artist_detail(conn: &Connection, artist_name: &str) -> AppResult<ArtistDetail> {
    let artists = get_artists(conn)?;
    let summary = artists
        .into_iter()
        .find(|a| a.name.eq_ignore_ascii_case(artist_name))
        .unwrap_or_else(|| ArtistSummary {
            name: artist_name.to_string(),
            album_count: 0,
            track_count: 0,
            total_duration_ms: 0,
            is_favorite: false,
            cover_art_path: None,
        });

    let mut album_stmt = conn.prepare(
        r#"
        SELECT
            album,
            artist,
            album_artist,
            MIN(year) as year,
            genre,
            MAX(cover_art_path) as cover_art_path,
            COUNT(id) as track_count,
            SUM(duration_ms) as total_duration_ms,
            EXISTS(
                SELECT 1 FROM favorite_albums fa
                WHERE fa.album_title = tracks.album COLLATE NOCASE
                  AND fa.artist_name = COALESCE(NULLIF(tracks.album_artist, ''), tracks.artist) COLLATE NOCASE
            ) as is_fav
        FROM tracks
        WHERE (artist = ?1 COLLATE NOCASE OR album_artist = ?1 COLLATE NOCASE)
          AND is_corrupt = 0
        GROUP BY album COLLATE NOCASE
        ORDER BY year ASC, album COLLATE NOCASE ASC
        "#,
    )?;

    let album_rows = album_stmt.query_map(params![artist_name], |row| {
        Ok(AlbumSummary {
            title: row.get(0)?,
            artist: row.get(1)?,
            album_artist: row.get(2)?,
            year: row.get(3)?,
            genre: row.get(4)?,
            cover_art_path: row.get(5)?,
            track_count: row.get::<_, i64>(6)? as u32,
            total_duration_ms: row.get::<_, Option<i64>>(7)?.unwrap_or(0) as u64,
            is_favorite: row.get::<_, i32>(8)? != 0,
        })
    })?;

    let mut albums = Vec::new();
    for a in album_rows {
        albums.push(a?);
    }

    let mut track_stmt = conn.prepare(
        r#"
        SELECT * FROM tracks
        WHERE (artist = ?1 COLLATE NOCASE OR album_artist = ?1 COLLATE NOCASE)
          AND is_corrupt = 0
        ORDER BY album COLLATE NOCASE ASC, disc_number ASC, track_number ASC, title COLLATE NOCASE ASC
        "#,
    )?;
    let track_rows = track_stmt.query_map(params![artist_name], map_row_to_track)?;
    let mut tracks = Vec::new();
    for t in track_rows {
        tracks.push(t?);
    }

    Ok(ArtistDetail {
        summary,
        albums,
        tracks,
    })
}

pub fn get_albums(conn: &Connection) -> AppResult<Vec<AlbumSummary>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            album,
            artist,
            album_artist,
            MIN(year) as year,
            genre,
            MAX(cover_art_path) as cover_art_path,
            COUNT(id) as track_count,
            SUM(duration_ms) as total_duration_ms,
            EXISTS(
                SELECT 1 FROM favorite_albums fa
                WHERE fa.album_title = tracks.album COLLATE NOCASE
                  AND fa.artist_name = COALESCE(NULLIF(tracks.album_artist, ''), tracks.artist) COLLATE NOCASE
            ) as is_fav
        FROM tracks
        WHERE is_corrupt = 0
        GROUP BY album COLLATE NOCASE, COALESCE(NULLIF(album_artist, ''), artist) COLLATE NOCASE
        ORDER BY album COLLATE NOCASE ASC
        "#,
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(AlbumSummary {
            title: row.get(0)?,
            artist: row.get(1)?,
            album_artist: row.get(2)?,
            year: row.get(3)?,
            genre: row.get(4)?,
            cover_art_path: row.get(5)?,
            track_count: row.get::<_, i64>(6)? as u32,
            total_duration_ms: row.get::<_, Option<i64>>(7)?.unwrap_or(0) as u64,
            is_favorite: row.get::<_, i32>(8)? != 0,
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn get_album_detail(
    conn: &Connection,
    album_title: &str,
    artist_name: Option<&str>,
) -> AppResult<AlbumDetail> {
    let albums = get_albums(conn)?;
    let summary = albums
        .into_iter()
        .find(|a| {
            a.title.eq_ignore_ascii_case(album_title)
                && artist_name.map_or(true, |art| {
                    a.artist.eq_ignore_ascii_case(art)
                        || a.album_artist
                            .as_deref()
                            .unwrap_or("")
                            .eq_ignore_ascii_case(art)
                })
        })
        .unwrap_or_else(|| AlbumSummary {
            title: album_title.to_string(),
            artist: artist_name.unwrap_or("Unknown Artist").to_string(),
            album_artist: None,
            year: None,
            genre: None,
            cover_art_path: None,
            track_count: 0,
            total_duration_ms: 0,
            is_favorite: false,
        });

    let mut track_stmt = conn.prepare(
        r#"
        SELECT * FROM tracks
        WHERE album = ?1 COLLATE NOCASE
          AND is_corrupt = 0
        ORDER BY disc_number ASC, track_number ASC, title COLLATE NOCASE ASC
        "#,
    )?;
    let track_rows = track_stmt.query_map(params![album_title], map_row_to_track)?;
    let mut tracks = Vec::new();
    for t in track_rows {
        tracks.push(t?);
    }

    Ok(AlbumDetail { summary, tracks })
}

pub fn get_genres(conn: &Connection) -> AppResult<Vec<GenreSummary>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            genre,
            COUNT(id) AS track_count,
            COUNT(DISTINCT album) AS album_count,
            COUNT(DISTINCT COALESCE(NULLIF(album_artist, ''), artist)) AS artist_count
        FROM tracks
        WHERE genre IS NOT NULL AND genre != '' AND is_corrupt = 0
        GROUP BY genre COLLATE NOCASE
        ORDER BY track_count DESC, genre COLLATE NOCASE ASC
        "#,
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(GenreSummary {
            name: row.get(0)?,
            track_count: row.get::<_, i64>(1)? as u32,
            album_count: row.get::<_, i64>(2)? as u32,
            artist_count: row.get::<_, i64>(3)? as u32,
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn set_artist_favorite(
    conn: &Connection,
    artist_name: &str,
    is_favorite: bool,
) -> AppResult<()> {
    if is_favorite {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO favorite_artists (artist_name, created_at) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
            params![artist_name, now],
        )?;
    } else {
        conn.execute(
            "DELETE FROM favorite_artists WHERE artist_name = ?1 COLLATE NOCASE",
            params![artist_name],
        )?;
    }
    Ok(())
}

pub fn set_album_favorite(
    conn: &Connection,
    album_title: &str,
    artist_name: &str,
    is_favorite: bool,
) -> AppResult<()> {
    let key = format!(
        "{}::{}",
        album_title.to_lowercase(),
        artist_name.to_lowercase()
    );
    if is_favorite {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            r#"
            INSERT INTO favorite_albums (album_key, album_title, artist_name, created_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT DO NOTHING
            "#,
            params![key, album_title, artist_name, now],
        )?;
    } else {
        conn.execute(
            "DELETE FROM favorite_albums WHERE album_key = ?1 COLLATE NOCASE",
            params![key],
        )?;
    }
    Ok(())
}

pub fn get_home_feed(conn: &Connection) -> AppResult<HomeFeed> {
    let mut rec_stmt = conn
        .prepare("SELECT * FROM tracks WHERE is_corrupt = 0 ORDER BY date_added DESC LIMIT 20")?;
    let recently_added = rec_stmt
        .query_map([], map_row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    let mut most_stmt = conn.prepare(
        "SELECT * FROM tracks WHERE is_corrupt = 0 AND play_count > 0 ORDER BY play_count DESC LIMIT 20",
    )?;
    let most_played = most_stmt
        .query_map([], map_row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    let mut rec_played_stmt = conn.prepare(
        "SELECT * FROM tracks WHERE is_corrupt = 0 AND last_played_at IS NOT NULL ORDER BY last_played_at DESC LIMIT 20",
    )?;
    let recently_played = rec_played_stmt
        .query_map([], map_row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    let mut fav_tracks_stmt = conn.prepare(
        "SELECT * FROM tracks WHERE is_favorite = 1 AND is_corrupt = 0 ORDER BY date_added DESC LIMIT 30",
    )?;
    let favorite_tracks = fav_tracks_stmt
        .query_map([], map_row_to_track)?
        .filter_map(|r| r.ok())
        .collect();

    let all_albums = get_albums(conn)?;
    let favorite_albums = all_albums.into_iter().filter(|a| a.is_favorite).collect();

    let all_artists = get_artists(conn)?;
    let favorite_artists = all_artists.into_iter().filter(|a| a.is_favorite).collect();

    let (total_tracks, total_duration_ms): (i64, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(id), SUM(duration_ms) FROM tracks WHERE is_corrupt = 0",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, None));

    let total_albums: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT album) FROM tracks WHERE is_corrupt = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let total_artists: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT COALESCE(NULLIF(album_artist, ''), artist)) FROM tracks WHERE is_corrupt = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(HomeFeed {
        recently_added,
        most_played,
        recently_played,
        favorite_tracks,
        favorite_albums,
        favorite_artists,
        total_tracks: total_tracks as u32,
        total_albums: total_albums as u32,
        total_artists: total_artists as u32,
        total_duration_ms: total_duration_ms.unwrap_or(0) as u64,
    })
}
