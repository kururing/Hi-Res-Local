use chrono::Utc;
use rusqlite::{params, Connection};

use crate::db::queries_tracks::{get_track_by_id, increment_play_count};
use crate::error::AppResult;
use crate::models::history::{PlayHistoryEntry, RecordPlayInput};

pub fn record_play_history(
    conn: &Connection,
    input: &RecordPlayInput,
) -> AppResult<PlayHistoryEntry> {
    let now = Utc::now().to_rfc3339();

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
    let mut stmt = conn.prepare(
        r#"
        SELECT id, track_id, played_at, completed_duration_ms, fully_played
        FROM play_history
        ORDER BY played_at DESC
        LIMIT ?1 OFFSET ?2
        "#,
    )?;

    let rows = stmt.query_map(params![limit, offset], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)? as u64,
            row.get::<_, i32>(4)? != 0,
        ))
    })?;

    let mut entries = Vec::new();
    for r in rows {
        let (id, track_id, played_at, completed_duration_ms, fully_played) = r?;
        let track = get_track_by_id(conn, &track_id)?;
        entries.push(PlayHistoryEntry {
            id,
            track_id,
            track,
            played_at,
            completed_duration_ms,
            fully_played,
        });
    }

    Ok(entries)
}

pub fn clear_play_history(conn: &Connection) -> AppResult<usize> {
    let count = conn.execute("DELETE FROM play_history", [])?;
    Ok(count)
}
