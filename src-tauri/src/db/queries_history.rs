use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

use crate::db::queries_tracks::{get_track_by_id, increment_play_count};
use crate::error::AppResult;
use crate::models::history::{PlayHistoryEntry, RecordPlayInput};

pub fn record_play_history(
    conn: &Connection,
    input: &RecordPlayInput,
) -> AppResult<PlayHistoryEntry> {
    let now = Utc::now();

    // A playback open used to emit the same track-change notification more than
    // once. Keep this write idempotent across UI remounts and duplicate events.
    let latest = conn
        .query_row(
            r#"
            SELECT id, played_at, completed_duration_ms, fully_played
            FROM play_history
            WHERE track_id = ?1
            ORDER BY id DESC
            LIMIT 1
            "#,
            params![input.track_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? as u64,
                    row.get::<_, i32>(3)? != 0,
                ))
            },
        )
        .ok();

    if let Some((id, played_at, completed_duration_ms, fully_played)) = latest {
        let is_duplicate_start = !input.fully_played
            && input.completed_duration_ms == 0
            && !fully_played
            && completed_duration_ms == 0
            && DateTime::parse_from_rfc3339(&played_at)
                .map(|previous| now.signed_duration_since(previous).num_milliseconds() < 2_000)
                .unwrap_or(false);
        if is_duplicate_start {
            return Ok(PlayHistoryEntry {
                id,
                track_id: input.track_id.clone(),
                track: get_track_by_id(conn, &input.track_id)?,
                played_at,
                completed_duration_ms,
                fully_played,
            });
        }
    }

    let now = now.to_rfc3339();

    conn.execute(
        r#"
        INSERT INTO play_history (track_id, played_at, completed_duration_ms, fully_played)
        VALUES (?1, ?2, ?3, ?4)
        "#,
        params![
            input.track_id,
            now,
            input.completed_duration_ms as i64,
            if input.fully_played { 1 } else { 0 }
        ],
    )?;

    let id = conn.last_insert_rowid();

    // Increment play count on track if played significantly or fully
    if input.fully_played || input.completed_duration_ms >= 30_000 {
        let _ = increment_play_count(conn, &input.track_id, &now);
    }

    let track = get_track_by_id(conn, &input.track_id)?;

    Ok(PlayHistoryEntry {
        id,
        track_id: input.track_id.clone(),
        track,
        played_at: now,
        completed_duration_ms: input.completed_duration_ms,
        fully_played: input.fully_played,
    })
}

pub fn get_play_history(
    conn: &Connection,
    limit: u32,
    offset: u32,
) -> AppResult<Vec<PlayHistoryEntry>> {
    // Read a wider raw window so legacy duplicate rows do not reduce the
    // requested number of visible history items after collapsing.
    let fetch_limit = limit.saturating_mul(4);
    let mut stmt = conn.prepare(
        r#"
        SELECT id, track_id, played_at, completed_duration_ms, fully_played
        FROM play_history
        ORDER BY played_at DESC
        LIMIT ?1 OFFSET ?2
        "#,
    )?;

    let rows = stmt.query_map(params![fetch_limit, offset], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)? as u64,
            row.get::<_, i32>(4)? != 0,
        ))
    })?;

    let mut entries: Vec<PlayHistoryEntry> = Vec::new();
    for r in rows {
        let (id, track_id, played_at, completed_duration_ms, fully_played) = r?;
        let track = get_track_by_id(conn, &track_id)?;
        let entry = PlayHistoryEntry {
            id,
            track_id,
            track,
            played_at,
            completed_duration_ms,
            fully_played,
        };
        let duplicate_start = entries.last().is_some_and(|previous| {
            previous.track_id == entry.track_id
                && !previous.fully_played
                && previous.completed_duration_ms == 0
                && !entry.fully_played
                && entry.completed_duration_ms == 0
                && match (
                    DateTime::parse_from_rfc3339(&previous.played_at),
                    DateTime::parse_from_rfc3339(&entry.played_at),
                ) {
                    (Ok(newer), Ok(older)) => {
                        newer.signed_duration_since(older).num_milliseconds().abs() < 2_000
                    }
                    _ => false,
                }
        });
        if !duplicate_start {
            entries.push(entry);
            if entries.len() >= limit as usize {
                break;
            }
        }
    }

    Ok(entries)
}

pub fn clear_play_history(conn: &Connection) -> AppResult<usize> {
    let count = conn.execute("DELETE FROM play_history", [])?;
    Ok(count)
}
