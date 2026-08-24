pub mod backup;
pub mod migrations;
pub mod queries_history;
pub mod queries_library;
pub mod queries_playlists;
pub mod queries_settings;
pub mod queries_tracks;
pub mod schema;

use directories::ProjectDirs;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::db::migrations::run_migrations;
use crate::error::{AppError, AppResult};

pub struct Database {
    conn: Mutex<Connection>,
    db_path: Option<PathBuf>,
}

impl Database {
    pub fn open_default() -> AppResult<Self> {
        let path = Self::default_db_path()?;
        Self::open_path(&path)
    }

    pub fn open_path(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut conn = Connection::open(path)?;
        run_migrations(&mut conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            db_path: Some(path.to_path_buf()),
        })
    }

    pub fn open_in_memory() -> AppResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        run_migrations(&mut conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            db_path: None,
        })
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        crate::sync_util::recover_mutex(&self.conn)
    }

    pub fn db_path(&self) -> Option<&Path> {
        self.db_path.as_deref()
    }

    pub fn default_db_path() -> AppResult<PathBuf> {
        let proj = ProjectDirs::from("com", "nghenhacpromax", "app").ok_or_else(|| {
            AppError::Path("Failed to determine project data directory".to_string())
        })?;
        let data_dir = proj.data_dir();
        Ok(data_dir.join("library.db"))
    }
}
