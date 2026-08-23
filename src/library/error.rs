use thiserror::Error;

/// Actionable errors that can occur during library operations.
#[derive(Debug, Error)]
pub enum LibraryError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Metadata extraction error for '{path}': {message}")]
    Metadata { path: String, message: String },

    #[error("Entity not found: {0}")]
    NotFound(String),

    #[error("Platform data directory could not be determined")]
    DataDirectoryUnavailable,

    #[error("Lock acquisition error: {0}")]
    Lock(String),

    #[error("Invalid data: {0}")]
    InvalidData(String),
}
