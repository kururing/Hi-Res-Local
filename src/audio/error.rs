//! Audio engine error definitions.

use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;

/// Errors that can occur during audio playback backend operations.
#[derive(Debug, Error)]
pub enum AudioError {
    /// Failed to initialize audio output stream.
    #[error("Audio output stream initialization failed: {0}")]
    StreamInitialization(String),

    /// No audio output device available on the host system.
    #[error("Audio output device unavailable: {0}")]
    DeviceUnavailable(String),

    /// Failed to create audio sink on output stream handle.
    #[error("Audio sink creation failed: {0}")]
    SinkCreation(String),

    /// Track audio file not found or inaccessible.
    #[error("Track file inaccessible at '{path}': {source}")]
    FileAccess {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    /// Failed to decode audio file.
    #[error("Failed to decode audio track at '{path}': {details}")]
    DecodeError { path: PathBuf, details: String },

    /// Audio seek operation failed.
    #[error("Audio seek to {position:?} failed: {reason}")]
    SeekError { position: Duration, reason: String },

    /// General audio playback error.
    #[error("Audio playback error: {0}")]
    Playback(String),
}
