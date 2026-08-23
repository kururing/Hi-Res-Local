use chrono::Utc;
use rusqlite::{params, Connection};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use crate::db::queries_tracks::{get_track_by_path, map_row_to_track};
use crate::error::{AppError, AppResult};
use crate::models::playlist::{
    CreatePlaylistInput, Playlist, PlaylistWithTracks, UpdatePlaylistInput,
};
use crate::models::smart_playlist::{
    MatchType, SmartField, SmartOperator, SmartPlaylistDefinition, SmartSortBy, SortOrder,
};
use crate::models::track::Track;

pub fn create_playlist(conn: &Connection, input: &CreatePlaylistInput) -> AppResult<Playlist> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let is_smart = input.is_smart.unwrap_or(false);

    conn.execute(
        r#"
        INSERT INTO playlists (id, name, description, is_smart, rules_json, cover_art_path, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)
        "#,
        params![
            id,
            input.name,
            input.description,
            if is_smart { 1 } else { 0 },
            input.rules_json,
            now,
            now
        ],
    )?;

    get_playlist_by_id(conn, &id)?
        .ok_or_else(|| AppError::Internal("Failed to retrieve created playlist".to_string()))
}

pub fn get_playlists(conn: &Connection) -> AppResult<Vec<Playlist>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            p.id,
            p.name,
            p.description,
            p.is_smart,
            p.rules_json,
            p.cover_art_path,
            p.created_at,
            p.updated_at,
            COUNT(pt.track_id) AS manual_track_count,
            COALESCE(SUM(t.duration_ms), 0) AS manual_duration_ms
        FROM playlists p
        LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
        LEFT JOIN tracks t ON pt.track_id = t.id
        GROUP BY p.id
        ORDER BY p.created_at ASC
        "#,
    )?;

    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let description: Option<String> = row.get(2)?;
        let is_smart: bool = row.get::<_, i32>(3)? != 0;
        let rules_json: Option<String> = row.get(4)?;
        let cover_art_path: Option<String> = row.get(5)?;
        let created_at: String = row.get(6)?;
        let updated_at: String = row.get(7)?;
        let manual_track_count: u32 = row.get::<_, i64>(8)? as u32;
        let manual_duration_ms: u64 = row.get::<_, i64>(9)? as u64;

        Ok(Playlist {
            id,
            name,
            description,
            is_smart,
            rules_json,
            cover_art_path,
            track_count: manual_track_count,
            total_duration_ms: manual_duration_ms,
            created_at,
            updated_at,
        })
    })?;

    let mut playlists = Vec::new();
    for r in rows {
        let mut playlist = r?;
        if playlist.is_smart {
            if let Ok(tracks) = evaluate_smart_playlist_tracks(conn, &playlist) {
                playlist.track_count = tracks.len() as u32;
                playlist.total_duration_ms = tracks.iter().map(|t| t.duration_ms).sum();
            }
        }
        playlists.push(playlist);
    }
    Ok(playlists)
}

pub fn get_playlist_by_id(conn: &Connection, id: &str) -> AppResult<Option<Playlist>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            p.id,
            p.name,
            p.description,
            p.is_smart,
            p.rules_json,
            p.cover_art_path,
            p.created_at,
            p.updated_at,
            COUNT(pt.track_id) AS manual_track_count,
            COALESCE(SUM(t.duration_ms), 0) AS manual_duration_ms
        FROM playlists p
        LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
        LEFT JOIN tracks t ON pt.track_id = t.id
        WHERE p.id = ?1
        GROUP BY p.id
        "#,
    )?;

    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        let mut playlist = Playlist {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            is_smart: row.get::<_, i32>(3)? != 0,
            rules_json: row.get(4)?,
            cover_art_path: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            track_count: row.get::<_, i64>(8)? as u32,
            total_duration_ms: row.get::<_, i64>(9)? as u64,
        };

        if playlist.is_smart {
            if let Ok(tracks) = evaluate_smart_playlist_tracks(conn, &playlist) {
                playlist.track_count = tracks.len() as u32;
                playlist.total_duration_ms = tracks.iter().map(|t| t.duration_ms).sum();
            }
        }
        Ok(Some(playlist))
    } else {
        Ok(None)
    }
}

pub fn get_playlist_with_tracks(
    conn: &Connection,
    playlist_id: &str,
) -> AppResult<PlaylistWithTracks> {
    let playlist = get_playlist_by_id(conn, playlist_id)?
        .ok_or_else(|| AppError::NotFound(format!("Playlist not found: {}", playlist_id)))?;

    let tracks = if playlist.is_smart {
        evaluate_smart_playlist_tracks(conn, &playlist)?
    } else {
        let mut stmt = conn.prepare(
            r#"
            SELECT t.* FROM tracks t
            JOIN playlist_tracks pt ON t.id = pt.track_id
            WHERE pt.playlist_id = ?1
            ORDER BY pt.position ASC
            "#,
        )?;
        let rows = stmt.query_map(params![playlist_id], map_row_to_track)?;
        let mut res = Vec::new();
        for r in rows {
            res.push(r?);
        }
        res
    };

    Ok(PlaylistWithTracks { playlist, tracks })
}

pub fn update_playlist(conn: &Connection, input: &UpdatePlaylistInput) -> AppResult<Playlist> {
    let now = Utc::now().to_rfc3339();
    let mut sets = vec!["updated_at = ?"];
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];

    if let Some(ref name) = input.name {
        sets.push("name = ?");
        params_vec.push(Box::new(name.clone()));
    }
    if let Some(ref desc) = input.description {
        sets.push("description = ?");
        params_vec.push(Box::new(desc.clone()));
    }
    if let Some(ref rules) = input.rules_json {
        sets.push("rules_json = ?");
        params_vec.push(Box::new(rules.clone()));
    }
    if let Some(ref cover) = input.cover_art_path {
        sets.push("cover_art_path = ?");
        params_vec.push(Box::new(cover.clone()));
    }

    params_vec.push(Box::new(input.id.clone()));
    let sql = format!("UPDATE playlists SET {} WHERE id = ?", sets.join(", "));

    let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();
    let rows = conn.execute(&sql, rusqlite_params.as_slice())?;
    if rows == 0 {
        return Err(AppError::NotFound(format!(
            "Playlist not found: {}",
            input.id
        )));
    }

    get_playlist_by_id(conn, &input.id)?
        .ok_or_else(|| AppError::Internal("Failed to load updated playlist".to_string()))
}

pub fn delete_playlist(conn: &Connection, id: &str) -> AppResult<bool> {
    let rows = conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn add_tracks_to_playlist(
    conn: &mut Connection,
    playlist_id: &str,
    track_ids: &[String],
) -> AppResult<u32> {
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    let tx = conn.transaction()?;
    let now = Utc::now().to_rfc3339();
    let mut current_pos = (max_pos + 1) as u32;
    let mut added = 0;

    for track_id in track_ids {
        let inserted = tx.execute(
            r#"
            INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT DO NOTHING
            "#,
            params![playlist_id, track_id, current_pos, now],
        )?;
        if inserted > 0 {
            current_pos += 1;
            added += 1;
        }
    }

    tx.commit()?;
    Ok(added)
}

pub fn remove_tracks_from_playlist(
    conn: &mut Connection,
    playlist_id: &str,
    track_ids: &[String],
) -> AppResult<usize> {
    let tx = conn.transaction()?;
    let mut removed = 0;
    for track_id in track_ids {
        removed += tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
        )?;
    }

    let remaining_ids: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC",
        )?;
        let rows = stmt
            .query_map(params![playlist_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    for (pos, tid) in remaining_ids.iter().enumerate() {
        tx.execute(
            "UPDATE playlist_tracks SET position = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
            params![pos as u32, playlist_id, tid],
        )?;
    }

    tx.commit()?;
    Ok(removed)
}

pub fn reorder_playlist_tracks(
    conn: &mut Connection,
    playlist_id: &str,
    ordered_track_ids: &[String],
) -> AppResult<()> {
    let tx = conn.transaction()?;
    // Step 1: Set temporary negative positions to prevent uniqueness collision on (playlist_id, position)
    for (pos, track_id) in ordered_track_ids.iter().enumerate() {
        tx.execute(
            "UPDATE playlist_tracks SET position = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
            params![-100000 - (pos as i64), playlist_id, track_id],
        )?;
    }
    // Step 2: Set final positive positions
    for (pos, track_id) in ordered_track_ids.iter().enumerate() {
        tx.execute(
            "UPDATE playlist_tracks SET position = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
            params![pos as u32, playlist_id, track_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn build_smart_playlist_query(
    def: &SmartPlaylistDefinition,
) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut sql = String::from("SELECT * FROM tracks WHERE is_corrupt = 0 ");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if !def.rules.is_empty() {
        let op_join = match def.match_type {
            MatchType::All => " AND ",
            MatchType::Any => " OR ",
        };

        let mut clauses = Vec::new();
        for rule in &def.rules {
            let col = match rule.field {
                SmartField::Title => "title",
                SmartField::Artist => "artist",
                SmartField::Album => "album",
                SmartField::Genre => "genre",
                SmartField::Year => "year",
                SmartField::Rating => "rating",
                SmartField::PlayCount => "play_count",
                SmartField::SkipCount => "skip_count",
                SmartField::Bitrate => "bitrate",
                SmartField::DurationMs => "duration_ms",
                SmartField::Format => "format",
                SmartField::IsFavorite => "is_favorite",
                SmartField::DateAdded => "date_added",
                SmartField::LastPlayedAt => "last_played_at",
            };

            match rule.operator {
                SmartOperator::Equals => {
                    clauses.push(format!("{} = ?", col));
                    params_vec.push(Box::new(rule.value.clone()));
                }
                SmartOperator::NotEquals => {
                    clauses.push(format!("{} != ?", col));
                    params_vec.push(Box::new(rule.value.clone()));
                }
                SmartOperator::Contains => {
                    clauses.push(format!("{} LIKE ?", col));
                    params_vec.push(Box::new(format!("%{}%", rule.value)));
                }
                SmartOperator::NotContains => {
                    clauses.push(format!("{} NOT LIKE ?", col));
                    params_vec.push(Box::new(format!("%{}%", rule.value)));
                }
                SmartOperator::StartsWith => {
                    clauses.push(format!("{} LIKE ?", col));
                    params_vec.push(Box::new(format!("{}%", rule.value)));
                }
                SmartOperator::EndsWith => {
                    clauses.push(format!("{} LIKE ?", col));
                    params_vec.push(Box::new(format!("%{}", rule.value)));
                }
                SmartOperator::GreaterThan => {
                    let num: i64 = rule.value.parse().unwrap_or(0);
                    clauses.push(format!("{} > ?", col));
                    params_vec.push(Box::new(num));
                }
                SmartOperator::LessThan => {
                    let num: i64 = rule.value.parse().unwrap_or(0);
                    clauses.push(format!("{} < ?", col));
                    params_vec.push(Box::new(num));
                }
                SmartOperator::GreaterThanOrEqual => {
                    let num: i64 = rule.value.parse().unwrap_or(0);
                    clauses.push(format!("{} >= ?", col));
                    params_vec.push(Box::new(num));
                }
                SmartOperator::LessThanOrEqual => {
                    let num: i64 = rule.value.parse().unwrap_or(0);
                    clauses.push(format!("{} <= ?", col));
                    params_vec.push(Box::new(num));
                }
                SmartOperator::InTheLastDays => {
                    let days: i64 = rule.value.parse().unwrap_or(30);
                    clauses.push(format!(
                        "{} >= datetime('now', '-{} days')",
                        col,
                        days.max(1)
                    ));
                }
            }
        }

        if !clauses.is_empty() {
            sql.push_str(&format!("AND ({}) ", clauses.join(op_join)));
        }
    }

    let order_col = match def.sort_by.as_ref().unwrap_or(&SmartSortBy::Title) {
        SmartSortBy::Title => "title COLLATE NOCASE",
        SmartSortBy::Artist => "artist COLLATE NOCASE",
        SmartSortBy::Album => "album COLLATE NOCASE",
        SmartSortBy::Year => "year",
        SmartSortBy::DateAdded => "date_added",
        SmartSortBy::LastPlayedAt => "last_played_at",
        SmartSortBy::PlayCount => "play_count",
        SmartSortBy::Rating => "rating",
        SmartSortBy::Duration => "duration_ms",
        SmartSortBy::Random => "RANDOM()",
    };

    let dir = match def.sort_order.as_ref().unwrap_or(&SortOrder::Asc) {
        SortOrder::Asc => "ASC",
        SortOrder::Desc => "DESC",
    };

    sql.push_str(&format!("ORDER BY {} {} ", order_col, dir));

    if let Some(limit) = def.limit {
        sql.push_str(&format!("LIMIT {} ", limit));
    }

    (sql, params_vec)
}

pub fn evaluate_smart_playlist_tracks(
    conn: &Connection,
    playlist: &Playlist,
) -> AppResult<Vec<Track>> {
    let rules_str = match &playlist.rules_json {
        Some(s) if !s.trim().is_empty() => s,
        _ => return Ok(Vec::new()),
    };

    let def: SmartPlaylistDefinition = serde_json::from_str(rules_str)?;
    let (sql, params_vec) = build_smart_playlist_query(&def);

    let mut stmt = conn.prepare(&sql)?;
    let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(rusqlite_params.as_slice(), map_row_to_track)?;

    let mut tracks = Vec::new();
    for r in rows {
        tracks.push(r?);
    }
    Ok(tracks)
}

pub fn export_playlist_to_m3u(
    conn: &Connection,
    playlist_id: &str,
    dest_path: &Path,
) -> AppResult<usize> {
    let playlist_with_tracks = get_playlist_with_tracks(conn, playlist_id)?;
    let mut file = File::create(dest_path)?;

    writeln!(file, "#EXTM3U")?;
    writeln!(file, "#PLAYLIST:{}", playlist_with_tracks.playlist.name)?;

    let mut count = 0;
    for track in &playlist_with_tracks.tracks {
        let duration_secs = track.duration_ms / 1000;
        writeln!(
            file,
            "#EXTINF:{},{} - {}",
            duration_secs, track.artist, track.title
        )?;
        writeln!(file, "{}", track.path)?;
        count += 1;
    }

    Ok(count)
}

pub fn import_playlist_from_m3u(
    conn: &mut Connection,
    file_path: &Path,
    custom_name: Option<String>,
) -> AppResult<PlaylistWithTracks> {
    let file = File::open(file_path)?;
    let reader = BufReader::new(file);

    let name = custom_name.unwrap_or_else(|| {
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Imported Playlist")
            .to_string()
    });

    let playlist_input = CreatePlaylistInput {
        name,
        description: Some(format!("Imported from {}", file_path.display())),
        is_smart: Some(false),
        rules_json: None,
    };

    let playlist = create_playlist(conn, &playlist_input)?;
    let mut track_ids = Vec::new();

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let mut candidate_path = Path::new(trimmed).to_path_buf();
        if candidate_path.is_relative() {
            if let Some(parent) = file_path.parent() {
                candidate_path = parent.join(candidate_path);
            }
        }

        let path_str = candidate_path.to_string_lossy().to_string();
        if let Some(track) = get_track_by_path(conn, trimmed)? {
            track_ids.push(track.id);
        } else if let Some(track) = get_track_by_path(conn, &path_str)? {
            track_ids.push(track.id);
        }
    }

    if !track_ids.is_empty() {
        add_tracks_to_playlist(conn, &playlist.id, &track_ids)?;
    }

    get_playlist_with_tracks(conn, &playlist.id)
}
