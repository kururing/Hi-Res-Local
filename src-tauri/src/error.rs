use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Metadata tag error: {0}")]
    Lofty(#[from] lofty::error::LoftyError),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Image processing error: {0}")]
    Image(#[from] image::ImageError),

    #[error("Filesystem watch error: {0}")]
    Notify(#[from] notify::Error),

    #[error("Path error: {0}")]
    Path(String),

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),

    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Backup/Restore error: {0}")]
    BackupRestore(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
