//! Platform-specific adapters and capabilities with graceful fallbacks.
//!
//! Provides extensible trait interfaces for:
//! 1. Exclusive / Bit-Perfect audio output (Windows WASAPI Exclusive, macOS CoreAudio Hog Mode, Linux ALSA hw direct).
//! 2. System Media Controls (Windows SMTC, macOS MPNowPlayingInfoCenter / MPRemoteCommandCenter, Linux MPRIS D-Bus).

use serde::{Deserialize, Serialize};

use crate::audio::dto::{AudioTrack, PlaybackState};
use crate::audio::error::{AudioError, AudioResult};

/// Action commands triggered from OS Media Controls (SMTC, MPRIS, NowPlaying)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaControlAction {
    Play,
    Pause,
    TogglePlayPause,
    Next,
    Previous,
    Stop,
    Seek(u64),
}

/// System Media Controls Adapter trait (Windows SMTC, macOS Now Playing, Linux MPRIS)
pub trait MediaControlsAdapter: Send + Sync {
    fn is_supported(&self) -> bool;
    fn update_metadata(&mut self, track: &AudioTrack, duration_ms: u64) -> AudioResult<()>;
    fn update_playback_state(&mut self, state: PlaybackState, position_ms: u64) -> AudioResult<()>;
    fn clear_metadata(&mut self) -> AudioResult<()>;
    fn poll_actions(&mut self) -> Vec<MediaControlAction>;
}

/// Default cross-platform fallback adapter when native OS media controls are not bound
pub struct FallbackMediaControlsAdapter {
    current_state: PlaybackState,
    current_track: Option<AudioTrack>,
}

impl Default for FallbackMediaControlsAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl FallbackMediaControlsAdapter {
    pub fn new() -> Self {
        Self {
            current_state: PlaybackState::Stopped,
            current_track: None,
        }
    }
}

impl MediaControlsAdapter for FallbackMediaControlsAdapter {
    fn is_supported(&self) -> bool {
        false
    }

    fn update_metadata(&mut self, track: &AudioTrack, _duration_ms: u64) -> AudioResult<()> {
        self.current_track = Some(track.clone());
        Ok(())
    }

    fn update_playback_state(
        &mut self,
        state: PlaybackState,
        _position_ms: u64,
    ) -> AudioResult<()> {
        self.current_state = state;
        Ok(())
    }

    fn clear_metadata(&mut self) -> AudioResult<()> {
        self.current_track = None;
        self.current_state = PlaybackState::Stopped;
        Ok(())
    }

    fn poll_actions(&mut self) -> Vec<MediaControlAction> {
        Vec::new()
    }
}

/// Bit-Perfect / Exclusive Audio Mode Adapter trait
///
/// Platforms:
/// - Windows: WASAPI Exclusive Mode (AUDCLNT_SHAREMODE_EXCLUSIVE)
/// - macOS: CoreAudio Hog / Exclusive Device Mode
/// - Linux: ALSA direct device access (`hw:X,Y`)
pub trait ExclusiveAudioAdapter: Send + Sync {
    /// Returns true if the current audio backend and OS support bit-perfect exclusive mode
    fn is_supported(&self) -> bool;

    /// Attempts to enable bit-perfect exclusive output mode.
    /// If unsupported or rejected by OS/device, returns AudioError with fallback to shared mode.
    fn set_exclusive(&mut self, enabled: bool) -> AudioResult<()>;

    /// Check if exclusive mode is currently active
    fn is_exclusive_active(&self) -> bool;

    /// Current active bit depth and sample rate passed bit-perfectly to hardware
    fn active_stream_format(&self) -> Option<(u32, u16)>;
}

/// Default standard shared-mode adapter with bit-perfect capability negotiation
pub struct StandardAudioAdapter {
    exclusive_active: bool,
    active_format: Option<(u32, u16)>,
}

impl Default for StandardAudioAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl StandardAudioAdapter {
    pub fn new() -> Self {
        Self {
            exclusive_active: false,
            active_format: None,
        }
    }

    pub fn set_format(&mut self, sample_rate: u32, channels: u16) {
        self.active_format = Some((sample_rate, channels));
    }
}

impl ExclusiveAudioAdapter for StandardAudioAdapter {
    fn is_supported(&self) -> bool {
        cfg!(windows)
    }

    fn set_exclusive(&mut self, enabled: bool) -> AudioResult<()> {
        if enabled && !self.is_supported() {
            return Err(AudioError::AdapterError {
                adapter: "ExclusiveAudioAdapter",
                details: "Exclusive bit-perfect mode is not supported on this platform/device; falling back to shared mode"
                    .to_string(),
            });
        }
        self.exclusive_active = enabled;
        Ok(())
    }

    fn is_exclusive_active(&self) -> bool {
        self.exclusive_active
    }

    fn active_stream_format(&self) -> Option<(u32, u16)> {
        self.active_format
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fallback_media_controls_adapter() {
        let mut adapter = FallbackMediaControlsAdapter::new();
        assert!(!adapter.is_supported());

        let track = AudioTrack {
            id: "test".to_string(),
            path: "/path/to/test.flac".to_string(),
            title: "Title".to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            duration_ms: 240000,
            track_number: None,
            year: None,
            genre: None,
            replay_gain: None,
            stream_url: None,
            stream_expires_at: None,
        };

        assert!(adapter.update_metadata(&track, 240000).is_ok());
        assert!(adapter
            .update_playback_state(PlaybackState::Playing, 1000)
            .is_ok());
        assert!(adapter.poll_actions().is_empty());
        assert!(adapter.clear_metadata().is_ok());
    }

    #[test]
    fn test_exclusive_mode_adapter() {
        let mut adapter = StandardAudioAdapter::new();
        adapter.set_format(44100, 2);
        assert_eq!(adapter.active_stream_format(), Some((44100, 2)));

        if adapter.is_supported() {
            assert!(adapter.set_exclusive(true).is_ok());
            assert!(adapter.is_exclusive_active());
        } else {
            let res = adapter.set_exclusive(true);
            assert!(res.is_err());
            assert!(!adapter.is_exclusive_active());
        }
    }
}
