use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("I/O error at {path}: {source}")]
    IoError {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("Audio device unavailable or disconnected: {0}")]
    DeviceUnavailable(String),

    #[error("Failed to initialize CPAL audio stream: {0}")]
    StreamInitialization(String),

    #[error("CPAL stream playback error: {0}")]
    StreamError(String),

    #[error("Audio format unsupported for path {path}: {details}")]
    UnsupportedFormat { path: PathBuf, details: String },

    #[error("Symphonia decoder error for path {path}: {details}")]
    DecodeError { path: PathBuf, details: String },

    #[error("Seek error at {target_ms}ms: {reason}")]
    SeekError { target_ms: u64, reason: String },

    #[error("Queue is empty")]
    QueueEmpty,

    #[error("Invalid queue index: {index} (len: {len})")]
    InvalidQueueIndex { index: usize, len: usize },

    #[error("Channel communication error: {0}")]
    ChannelError(String),

    #[error("Adapter error ({adapter}): {details}")]
    AdapterError {
        adapter: &'static str,
        details: String,
    },

    #[error("General playback error: {0}")]
    Playback(String),
}

pub type AudioResult<T> = Result<T, AudioError>;
