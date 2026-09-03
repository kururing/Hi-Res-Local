use std::io;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("I/O error at {path:?}: {source}")]
    Io {
        path: Option<PathBuf>,
        #[source]
        source: io::Error,
    },
    #[error("unsupported format: {0}")]
    Unsupported(String),
    #[error("decode failed: {0}")]
    Decode(String),
    #[error("probe failed: {0}")]
    Probe(String),
    #[error("seek failed: {0}")]
    Seek(String),
    #[error("invalid source: {0}")]
    InvalidSource(String),
    #[error("HTTP error: {0}")]
    Http(String),
}

pub type CoreResult<T> = Result<T, CoreError>;

impl CoreError {
    pub fn io(path: Option<PathBuf>, source: io::Error) -> Self {
        Self::Io { path, source }
    }
}

impl From<io::Error> for CoreError {
    fn from(source: io::Error) -> Self {
        Self::Io { path: None, source }
    }
}
