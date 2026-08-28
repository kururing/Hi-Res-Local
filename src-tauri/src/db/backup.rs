use rusqlite::Connection;
use std::path::Path;

use crate::db::migrations::run_migrations;
use crate::error::{AppError, AppResult};

pub fn backup_database(conn: &Connection, dest_path: &Path) -> AppResult<()> {
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let tmp_path = dest_path.with_extension("db.tmp");
    let _ = std::fs::remove_file(&tmp_path);
    let mut dest_conn = Connection::open(&tmp_path)?;
    let backup = rusqlite::backup::Backup::new(conn, &mut dest_conn)?;
    backup.run_to_completion(100, std::time::Duration::from_millis(50), None)?;
    drop(backup);
    drop(dest_conn);
    std::fs::rename(&tmp_path, dest_path)?;
    Ok(())
}

pub fn restore_database(target_conn: &mut Connection, backup_path: &Path) -> AppResult<()> {
    if !backup_path.exists() {
        return Err(AppError::NotFound(format!(
            "Backup file does not exist: {}",
            backup_path.display()
        )));
    }

    // Verify backup integrity first
    let src_conn = Connection::open(backup_path)?;
    let check_result: String = {
        let mut stmt = src_conn.prepare("PRAGMA quick_check")?;
        stmt.query_row([], |row| row.get(0))?
    };
    if check_result != "ok" {
        return Err(AppError::BackupRestore(format!(
            "Backup database file is corrupt: {}",
            check_result
        )));
    }

    // Keep an in-memory copy so a failed restore/migration can be rolled back.
    let mut previous = Connection::open_in_memory()?;
    {
        let old_backup = rusqlite::backup::Backup::new(&*target_conn, &mut previous)?;
        old_backup.run_to_completion(100, std::time::Duration::from_millis(50), None)?;
    }

    let restore_result = (|| -> AppResult<()> {
        let backup = rusqlite::backup::Backup::new(&src_conn, target_conn)?;
        backup.run_to_completion(100, std::time::Duration::from_millis(50), None)?;
        drop(backup);
        run_migrations(target_conn)?;
        Ok(())
    })();
    if restore_result.is_err() {
        let rollback = rusqlite::backup::Backup::new(&previous, target_conn)?;
        rollback.run_to_completion(100, std::time::Duration::from_millis(50), None)?;
    }
    restore_result
}
