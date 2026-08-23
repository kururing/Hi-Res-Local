//! Audio playback engine, decoding, and output stream module placeholder.
//!
//! This module provides a placeholder implementation of [`AudioBackend`].
//! Feature workers can expand native audio playback via rodio/symphonia here.

use crate::app::{AudioBackend, LoopMode, PlaybackState, PlaybackStatus, Track};
use std::time::Duration;

/// Placeholder implementation of audio player engine.
#[derive(Debug, Default)]
pub struct AudioEngine {
    status: PlaybackStatus,
}

impl AudioEngine {
    pub fn new() -> Self {
        Self {
            status: PlaybackStatus::default(),
        }
    }
}

impl AudioBackend for AudioEngine {
    fn play(&mut self, track: &Track) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.status.current_track = Some(track.clone());
        self.status.state = PlaybackState::Playing;
        self.status.duration = track.duration;
        self.status.position = Duration::ZERO;
        Ok(())
    }

    fn pause(&mut self) {
        if self.status.state == PlaybackState::Playing {
            self.status.state = PlaybackState::Paused;
        }
    }

    fn resume(&mut self) {
        if self.status.state == PlaybackState::Paused {
            self.status.state = PlaybackState::Playing;
        }
    }

    fn stop(&mut self) {
        self.status.state = PlaybackState::Stopped;
        self.status.position = Duration::ZERO;
    }

    fn seek(&mut self, position: Duration) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.status.position = position.min(self.status.duration);
        Ok(())
    }

    fn set_volume(&mut self, volume: f32) {
        self.status.volume = volume.clamp(0.0, 1.0);
    }

    fn set_loop_mode(&mut self, mode: LoopMode) {
        self.status.loop_mode = mode;
    }

    fn set_shuffle(&mut self, shuffle: bool) {
        self.status.shuffle = shuffle;
    }

    fn get_status(&self) -> PlaybackStatus {
        self.status.clone()
    }
}
