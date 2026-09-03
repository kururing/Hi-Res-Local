use chrono::Utc;
use rusqlite::Connection;

use crate::db::schema::SCHEMA_V1;
use crate::error::AppResult;

pub const CURRENT_SCHEMA_VERSION: i32 = 1;

pub fn run_migrations(conn: &mut Connection) -> AppResult<()> {
    conn.execute_batch(SCHEMA_V1)?;
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN bit_depth INTEGER", []);
    let _ = conn.execute(
        "ALTER TABLE tracks ADD COLUMN is_mqa INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN isrc TEXT", []);

    let mut stmt = conn.prepare("SELECT MAX(version) FROM schema_migrations")?;
    let current_version: Option<i32> = stmt.query_row([], |row| row.get(0)).unwrap_or(None);

    let latest_version = current_version.unwrap_or(0);
    if latest_version < CURRENT_SCHEMA_VERSION {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![CURRENT_SCHEMA_VERSION, now],
        )?;
    }

    Ok(())
}
