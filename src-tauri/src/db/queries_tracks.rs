use rusqlite::{params, Connection, Row};

use crate::error::{AppError, AppResult};
use crate::models::duplicate::DuplicateGroup;
use crate::models::track::{Track, TrackFilter, TrackSortField, TrackUpdateTags};

pub fn map_row_to_track(row: &Row) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get("id")?,
        path: row.get("path")?,
        title: row.get("title")?,
        artist: row.get("artist")?,
        album_artist: row.get("album_artist")?,
        album: row.get("album")?,
        genre: row.get("genre")?,
        year: row.get("year")?,
        track_number: row.get("track_number")?,
        disc_number: row.get("disc_number")?,
        duration_ms: row.get::<_, i64>("duration_ms")? as u64,
        bitrate: row.get("bitrate")?,
        sample_rate: row.get("sample_rate")?,
        channels: row.get("channels")?,
        format: row.get("format")?,
        file_size: row.get::<_, i64>("file_size")? as u64,
        file_modified_at: row.get("file_modified_at")?,
        date_added: row.get("date_added")?,
        is_favorite: row.get::<_, i32>("is_favorite")? != 0,
        rating: row.get::<_, i32>("rating")? as u8,
        play_count: row.get::<_, i32>("play_count")? as u32,
        skip_count: row.get::<_, i32>("skip_count")? as u32,
        last_played_at: row.get("last_played_at")?,
        cover_art_path: row.get("cover_art_path")?,
        lyrics: row.get("lyrics")?,
        has_synced_lyrics: row.get::<_, i32>("has_synced_lyrics")? != 0,
        is_corrupt: row.get::<_, i32>("is_corrupt")? != 0,
        corrupt_reason: row.get("corrupt_reason")?,
        duplicate_group_id: row.get("duplicate_group_id")?,
        is_primary: row.get::<_, i32>("is_primary")? != 0,
    })
}

pub fn upsert_track(conn: &Connection, track: &Track) -> AppResult<()> {
    conn.execute(
        r#"
        INSERT INTO tracks (
            id, path, title, artist, album_artist, album, genre, year,
            track_number, disc_number, duration_ms, bitrate, sample_rate, channels,
            format, file_size, file_modified_at, date_added, is_favorite, rating,
            play_count, skip_count, last_played_at, cover_art_path, lyrics,
            has_synced_lyrics, is_corrupt, corrupt_reason, duplicate_group_id, is_primary
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
            ?9, ?10, ?11, ?12, ?13, ?14,
            ?15, ?16, ?17, ?18, ?19, ?20,
            ?21, ?22, ?23, ?24, ?25,
            ?26, ?27, ?28, ?29, ?30
        )
        ON CONFLICT(path) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album_artist = excluded.album_artist,
            album = excluded.album,
            genre = excluded.genre,
            year = excluded.year,
            track_number = excluded.track_number,
            disc_number = excluded.disc_number,
            duration_ms = excluded.duration_ms,
            bitrate = excluded.bitrate,
            sample_rate = excluded.sample_rate,
            channels = excluded.channels,
            format = excluded.format,
            file_size = excluded.file_size,
            file_modified_at = excluded.file_modified_at,
            cover_art_path = COALESCE(excluded.cover_art_path, tracks.cover_art_path),
            lyrics = COALESCE(excluded.lyrics, tracks.lyrics),
            has_synced_lyrics = excluded.has_synced_lyrics,
            is_corrupt = excluded.is_corrupt,
            corrupt_reason = excluded.corrupt_reason;
        "#,
        params![
            track.id,
            track.path,
            track.title,
            track.artist,
            track.album_artist,
            track.album,
            track.genre,
            track.year,
            track.track_number,
            track.disc_number,
            track.duration_ms as i64,
            track.bitrate,
            track.sample_rate,
            track.channels,
            track.format,
            track.file_size as i64,
            track.file_modified_at,
            track.date_added,
            if track.is_favorite { 1 } else { 0 },
            track.rating as i32,
            track.play_count as i32,
            track.skip_count as i32,
            track.last_played_at,
            track.cover_art_path,
            track.lyrics,
            if track.has_synced_lyrics { 1 } else { 0 },
            if track.is_corrupt { 1 } else { 0 },
            track.corrupt_reason,
            track.duplicate_group_id,
            if track.is_primary { 1 } else { 0 }
        ],
    )?;
    Ok(())
}

pub fn upsert_tracks_batch(conn: &mut Connection, tracks: &[Track]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for track in tracks {
        upsert_track(&tx, track)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn get_track_by_id(conn: &Connection, id: &str) -> AppResult<Option<Track>> {
    let mut stmt = conn.prepare("SELECT * FROM tracks WHERE id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(map_row_to_track(row)?))
    } else {
        Ok(None)
    }
}

pub fn get_track_by_path(conn: &Connection, path: &str) -> AppResult<Option<Track>> {
    let mut stmt = conn.prepare("SELECT * FROM tracks WHERE path = ?1")?;
    let mut rows = stmt.query(params![path])?;
    if let Some(row) = rows.next()? {
        Ok(Some(map_row_to_track(row)?))
    } else {
        Ok(None)
    }
}

pub fn get_tracks(conn: &Connection, filter: Option<TrackFilter>) -> AppResult<Vec<Track>> {
    let mut sql = String::from("SELECT * FROM tracks WHERE 1=1 ");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(f) = filter {
        if let Some(search) = f.search_query {
            let term = format!("%{}%", search.trim());
            sql.push_str("AND (title LIKE ? OR artist LIKE ? OR album LIKE ? OR genre LIKE ?) ");
            params_vec.push(Box::new(term.clone()));
            params_vec.push(Box::new(term.clone()));
            params_vec.push(Box::new(term.clone()));
            params_vec.push(Box::new(term));
        }

        if let Some(artist) = f.artist {
            sql.push_str("AND (artist = ? OR album_artist = ?) ");
            params_vec.push(Box::new(artist.clone()));
            params_vec.push(Box::new(artist));
        }

        if let Some(album) = f.album {
            sql.push_str("AND album = ? ");
            params_vec.push(Box::new(album));
        }

        if let Some(genre) = f.genre {
            sql.push_str("AND genre = ? ");
            params_vec.push(Box::new(genre));
        }

        if let Some(fav) = f.is_favorite {
            sql.push_str("AND is_favorite = ? ");
            params_vec.push(Box::new(if fav { 1 } else { 0 }));
        }

        if let Some(min_rating) = f.min_rating {
            sql.push_str("AND rating >= ? ");
            params_vec.push(Box::new(min_rating as i32));
        }

        if let Some(is_corrupt) = f.is_corrupt {
            sql.push_str("AND is_corrupt = ? ");
            params_vec.push(Box::new(if is_corrupt { 1 } else { 0 }));
        }

        if let Some(dup_only) = f.duplicate_only {
            if dup_only {
                sql.push_str("AND duplicate_group_id IS NOT NULL ");
            }
        }

        let sort_col = match f.sort_by.unwrap_or(TrackSortField::Title) {
            TrackSortField::Title => "title COLLATE NOCASE",
            TrackSortField::Artist => "artist COLLATE NOCASE",
            TrackSortField::Album => "album COLLATE NOCASE",
            TrackSortField::Year => "year",
            TrackSortField::Duration => "duration_ms",
            TrackSortField::DateAdded => "date_added",
            TrackSortField::PlayCount => "play_count",
            TrackSortField::Rating => "rating",
            TrackSortField::Bitrate => "bitrate",
            TrackSortField::TrackNumber => "track_number",
        };

        let direction = if f.sort_desc.unwrap_or(false) {
            "DESC"
        } else {
            "ASC"
        };
        sql.push_str(&format!("ORDER BY {} {} ", sort_col, direction));

        if let Some(limit) = f.limit {
            sql.push_str(&format!("LIMIT {} ", limit));
            if let Some(offset) = f.offset {
                sql.push_str(&format!("OFFSET {} ", offset));
            }
        }
    } else {
        sql.push_str("ORDER BY title COLLATE NOCASE ASC");
    }

    let mut stmt = conn.prepare(&sql)?;
    let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(rusqlite_params.as_slice(), map_row_to_track)?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn delete_track(conn: &Connection, id: &str) -> AppResult<bool> {
    let rows = conn.execute("DELETE FROM tracks WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn delete_tracks_by_paths(conn: &mut Connection, paths: &[String]) -> AppResult<usize> {
    let tx = conn.transaction()?;
    let mut count = 0;
    for path in paths {
        count += tx.execute("DELETE FROM tracks WHERE path = ?1", params![path])?;
    }
    tx.commit()?;
    Ok(count)
}

pub fn set_track_favorite(conn: &Connection, id: &str, is_favorite: bool) -> AppResult<()> {
    let val = if is_favorite { 1 } else { 0 };
    let rows = conn.execute(
        "UPDATE tracks SET is_favorite = ?1 WHERE id = ?2",
        params![val, id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Track not found: {}", id)));
    }
    Ok(())
}

pub fn set_track_rating(conn: &Connection, id: &str, rating: u8) -> AppResult<()> {
    let clamped = rating.min(5) as i32;
    let rows = conn.execute(
        "UPDATE tracks SET rating = ?1 WHERE id = ?2",
        params![clamped, id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Track not found: {}", id)));
    }
    Ok(())
}

pub fn update_track_tags(conn: &Connection, update: &TrackUpdateTags) -> AppResult<()> {
    let mut sets = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(ref title) = update.title {
        sets.push("title = ?");
        params_vec.push(Box::new(title.clone()));
    }
    if let Some(ref artist) = update.artist {
        sets.push("artist = ?");
        params_vec.push(Box::new(artist.clone()));
    }
    if let Some(ref album_artist) = update.album_artist {
        sets.push("album_artist = ?");
        params_vec.push(Box::new(album_artist.clone()));
    }
    if let Some(ref album) = update.album {
        sets.push("album = ?");
        params_vec.push(Box::new(album.clone()));
    }
    if let Some(ref genre) = update.genre {
        sets.push("genre = ?");
        params_vec.push(Box::new(genre.clone()));
    }
    if let Some(year) = update.year {
        sets.push("year = ?");
        params_vec.push(Box::new(year));
    }
    if let Some(track_number) = update.track_number {
        sets.push("track_number = ?");
        params_vec.push(Box::new(track_number));
    }
    if let Some(disc_number) = update.disc_number {
        sets.push("disc_number = ?");
        params_vec.push(Box::new(disc_number));
    }
    if let Some(ref lyrics) = update.lyrics {
        sets.push("lyrics = ?");
        params_vec.push(Box::new(lyrics.clone()));
    }

    if sets.is_empty() {
        return Ok(());
    }

    params_vec.push(Box::new(update.id.clone()));
    let sql = format!("UPDATE tracks SET {} WHERE id = ?", sets.join(", "));

    let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();
    let rows = conn.execute(&sql, rusqlite_params.as_slice())?;
    if rows == 0 {
        return Err(AppError::NotFound(format!(
            "Track not found: {}",
            update.id
        )));
    }
    Ok(())
}

pub fn increment_play_count(conn: &Connection, track_id: &str, played_at: &str) -> AppResult<()> {
    conn.execute(
        r#"
        UPDATE tracks SET
            play_count = play_count + 1,
            last_played_at = ?1
        WHERE id = ?2
        "#,
        params![played_at, track_id],
    )?;
    Ok(())
}

pub fn increment_skip_count(conn: &Connection, track_id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET skip_count = skip_count + 1 WHERE id = ?1",
        params![track_id],
    )?;
    Ok(())
}

pub fn mark_track_corrupt(conn: &Connection, id: &str, reason: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET is_corrupt = 1, corrupt_reason = ?1 WHERE id = ?2",
        params![reason, id],
    )?;
    Ok(())
}

pub fn update_duplicate_status(
    conn: &Connection,
    track_id: &str,
    duplicate_group_id: Option<&str>,
    is_primary: bool,
) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET duplicate_group_id = ?1, is_primary = ?2 WHERE id = ?3",
        params![duplicate_group_id, if is_primary { 1 } else { 0 }, track_id],
    )?;
    Ok(())
}

pub fn get_duplicate_groups(conn: &Connection) -> AppResult<Vec<DuplicateGroup>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT DISTINCT duplicate_group_id FROM tracks
        WHERE duplicate_group_id IS NOT NULL AND duplicate_group_id != ''
        "#,
    )?;
    let group_ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut groups = Vec::new();
    for group_id in group_ids {
        let mut track_stmt = conn.prepare(
            "SELECT * FROM tracks WHERE duplicate_group_id = ?1 ORDER BY is_primary DESC, bitrate DESC",
        )?;
        let tracks: Vec<Track> = track_stmt
            .query_map(params![group_id], map_row_to_track)?
            .filter_map(|r| r.ok())
            .collect();

        if tracks.len() > 1 {
            let primary = tracks
                .iter()
                .find(|t| t.is_primary)
                .cloned()
                .unwrap_or_else(|| tracks[0].clone());

            let dups = tracks.into_iter().filter(|t| t.id != primary.id).collect();

            groups.push(DuplicateGroup {
                group_key: group_id,
                primary_track: primary,
                duplicates: dups,
            });
        }
    }

    Ok(groups)
}
