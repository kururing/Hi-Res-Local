//! Audio playback engine, decoding, and output stream module.
//!
//! Provides a thread-safe, Rodio-based implementation of [`AudioBackend`].

pub mod engine;
pub mod error;

pub use engine::AudioEngine;
pub use error::AudioError;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{AudioBackend, LoopMode, PlaybackState, Track, TrackId};
    use std::path::PathBuf;
    use std::time::Duration;

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn test_audio_engine_is_send_and_sync() {
        assert_send_sync::<AudioEngine>();
    }

    #[test]
    fn test_default_status() {
        let engine = AudioEngine::new();
        let status = engine.get_status();

        assert_eq!(status.state, PlaybackState::Stopped);
        assert!(status.current_track.is_none());
        assert_eq!(status.position, Duration::ZERO);
        assert_eq!(status.duration, Duration::ZERO);
        assert!((status.volume - 1.0).abs() < f32::EPSILON);
        assert!(!status.is_muted);
        assert_eq!(status.loop_mode, LoopMode::Off);
        assert!(!status.shuffle);
    }

    #[test]
    fn test_volume_clamping() {
        let mut engine = AudioEngine::new();

        engine.set_volume(0.65);
        let status = engine.get_status();
        assert!((status.volume - 0.65).abs() < f32::EPSILON);

        // Test clamping upper bound
        engine.set_volume(1.8);
        let status = engine.get_status();
        assert!((status.volume - 1.0).abs() < f32::EPSILON);

        // Test clamping lower bound
        engine.set_volume(-0.5);
        let status = engine.get_status();
        assert!((status.volume - 0.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_mute_semantics() {
        let mut engine = AudioEngine::new();
        engine.set_volume(0.8);

        assert!(!engine.is_muted());
        assert!(!engine.get_status().is_muted);

        engine.toggle_mute();
        assert!(engine.is_muted());
        assert!(engine.get_status().is_muted);
        // Volume setting is preserved when muted
        assert!((engine.get_status().volume - 0.8).abs() < f32::EPSILON);

        engine.toggle_mute();
        assert!(!engine.is_muted());
        assert!(!engine.get_status().is_muted);
        assert!((engine.get_status().volume - 0.8).abs() < f32::EPSILON);

        engine.set_muted(true);
        assert!(engine.is_muted());
        engine.set_muted(false);
        assert!(!engine.is_muted());
    }

    #[test]
    fn test_loop_mode_transitions() {
        let mut engine = AudioEngine::new();

        assert_eq!(engine.get_status().loop_mode, LoopMode::Off);

        engine.set_loop_mode(LoopMode::Track);
        assert_eq!(engine.get_status().loop_mode, LoopMode::Track);

        engine.set_loop_mode(LoopMode::Playlist);
        assert_eq!(engine.get_status().loop_mode, LoopMode::Playlist);

        engine.set_loop_mode(LoopMode::Off);
        assert_eq!(engine.get_status().loop_mode, LoopMode::Off);
    }

    #[test]
    fn test_shuffle_transitions() {
        let mut engine = AudioEngine::new();

        assert!(!engine.get_status().shuffle);

        engine.set_shuffle(true);
        assert!(engine.get_status().shuffle);

        engine.set_shuffle(false);
        assert!(!engine.get_status().shuffle);
    }

    #[test]
    fn test_seek_clamping_without_track() {
        let mut engine = AudioEngine::new();

        // When duration is 0, seek should clamp cleanly without errors
        let res = engine.seek(Duration::from_secs(10));
        assert!(res.is_ok());
        assert_eq!(engine.get_status().position, Duration::ZERO);
    }

    #[test]
    fn test_play_missing_file_returns_error() {
        let mut engine = AudioEngine::new();
        let track = Track {
            id: TrackId::new(),
            title: "Non Existent Track".to_string(),
            artist: "Unknown Artist".to_string(),
            album: "Unknown Album".to_string(),
            duration: Duration::from_secs(180),
            path: PathBuf::from("this_file_definitely_does_not_exist_12345.mp3"),
            ..Default::default()
        };

        let result = engine.play(&track);
        assert!(result.is_err());

        // Status should remain stopped, no panic
        let status = engine.get_status();
        assert_eq!(status.state, PlaybackState::Stopped);
    }

    #[test]
    fn test_pause_resume_stop_transitions_without_panic() {
        let mut engine = AudioEngine::new();

        // Pausing/resuming while stopped should be safe no-op
        engine.pause();
        assert_eq!(engine.get_status().state, PlaybackState::Stopped);

        engine.resume();
        assert_eq!(engine.get_status().state, PlaybackState::Stopped);

        engine.stop();
        assert_eq!(engine.get_status().state, PlaybackState::Stopped);
        assert_eq!(engine.get_status().position, Duration::ZERO);
    }

    #[test]
    fn test_inherent_helpers_and_debug() {
        let engine = AudioEngine::new();
        let debug_str = format!("{:?}", engine);
        assert!(debug_str.contains("AudioEngine"));
        assert!(debug_str.contains("status"));
        assert!(!engine.has_active_sink());
    }

    #[test]
    fn test_audio_error_variants() {
        let err1 = AudioError::StreamInitialization("failed".to_string());
        assert!(err1.to_string().contains("initialization failed"));

        let err2 = AudioError::DeviceUnavailable("none".to_string());
        assert!(err2.to_string().contains("unavailable"));

        let err3 = AudioError::SinkCreation("sink err".to_string());
        assert!(err3.to_string().contains("sink creation"));

        let err4 = AudioError::DecodeError {
            path: PathBuf::from("test.mp3"),
            details: "bad header".to_string(),
        };
        assert!(err4.to_string().contains("bad header"));

        let err5 = AudioError::SeekError {
            position: Duration::from_secs(10),
            reason: "unsupported".to_string(),
        };
        assert!(err5.to_string().contains("unsupported"));

        let err6 = AudioError::Playback("overflow".to_string());
        assert!(err6.to_string().contains("overflow"));
    }
}
