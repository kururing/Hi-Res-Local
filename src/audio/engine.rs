//! Core native audio playback engine implementation using Rodio.

use crate::app::{AudioBackend, LoopMode, PlaybackState, PlaybackStatus, Track};
use crate::audio::error::AudioError;
use rodio::source::Source;
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
use std::fs::File;
use std::io::BufReader;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

/// Holds handle and shutdown channel for the background audio output stream thread.
struct DeviceController {
    handle: OutputStreamHandle,
    _shutdown_tx: Sender<()>,
}

impl DeviceController {
    /// Spawns a dedicated audio output stream thread to ensure stream lives on its creation thread.
    fn spawn() -> Result<Self, AudioError> {
        let (init_tx, init_rx): (
            Sender<Result<OutputStreamHandle, String>>,
            Receiver<Result<OutputStreamHandle, String>>,
        ) = mpsc::channel();
        let (shutdown_tx, shutdown_rx): (Sender<()>, Receiver<()>) = mpsc::channel();

        std::thread::Builder::new()
            .name("nghenhacpromax-audio-output".to_string())
            .spawn(move || match OutputStream::try_default() {
                Ok((stream, handle)) => {
                    if init_tx.send(Ok(handle)).is_ok() {
                        // Keep stream alive until shutdown signal or sender drop
                        let _ = shutdown_rx.recv();
                    }
                    drop(stream);
                }
                Err(err) => {
                    let _ = init_tx.send(Err(err.to_string()));
                }
            })
            .map_err(|err| {
                AudioError::StreamInitialization(format!(
                    "Failed to spawn audio worker thread: {err}"
                ))
            })?;

        match init_rx.recv() {
            Ok(Ok(handle)) => Ok(Self {
                handle,
                _shutdown_tx: shutdown_tx,
            }),
            Ok(Err(err_msg)) => Err(AudioError::DeviceUnavailable(err_msg)),
            Err(err) => Err(AudioError::StreamInitialization(format!(
                "Audio worker initialization channel closed prematurely: {err}"
            ))),
        }
    }
}

/// Internal mutable state for [`AudioEngine`].
struct AudioEngineInner {
    device: Option<DeviceController>,
    sink: Option<Sink>,
    status: PlaybackStatus,
}

impl AudioEngineInner {
    /// Creates a new inner engine state with default playback status.
    fn new() -> Self {
        let device = match DeviceController::spawn() {
            Ok(controller) => {
                tracing::info!("Audio output device controller initialized");
                Some(controller)
            }
            Err(err) => {
                tracing::warn!(
                    "Audio output stream not available during initialization: {}",
                    err
                );
                None
            }
        };

        Self {
            device,
            sink: None,
            status: PlaybackStatus::default(),
        }
    }

    /// Ensures an output stream handle is available, attempting lazy initialization if needed.
    fn ensure_handle(&mut self) -> Result<OutputStreamHandle, AudioError> {
        if let Some(device) = &self.device {
            return Ok(device.handle.clone());
        }

        match DeviceController::spawn() {
            Ok(controller) => {
                tracing::info!("Lazily initialized audio output device controller");
                let handle = controller.handle.clone();
                self.device = Some(controller);
                Ok(handle)
            }
            Err(err) => {
                tracing::error!("Failed to initialize audio output device: {}", err);
                Err(err)
            }
        }
    }

    /// Loads and begins playback of the specified track.
    fn play_track(&mut self, track: &Track) -> Result<(), AudioError> {
        // Validate file accessibility before allocating sink
        if !track.path.exists() {
            return Err(AudioError::FileAccess {
                path: track.path.clone(),
                source: std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Audio file does not exist on disk",
                ),
            });
        }

        let file = File::open(&track.path).map_err(|err| AudioError::FileAccess {
            path: track.path.clone(),
            source: err,
        })?;

        let reader = BufReader::new(file);

        let source = Decoder::new(reader).map_err(|err| AudioError::DecodeError {
            path: track.path.clone(),
            details: err.to_string(),
        })?;

        let handle = self.ensure_handle()?;

        // Clean resource replacement: terminate existing sink
        if let Some(old_sink) = self.sink.take() {
            old_sink.stop();
        }

        let sink =
            Sink::try_new(&handle).map_err(|err| AudioError::SinkCreation(err.to_string()))?;

        // Apply volume and mute settings
        if self.status.is_muted {
            sink.set_volume(0.0);
        } else {
            sink.set_volume(self.status.volume.clamp(0.0, 1.0));
        }

        // LoopMode::Track repeats source infinitely
        if self.status.loop_mode == LoopMode::Track {
            sink.append(source.repeat_infinite());
        } else {
            sink.append(source);
        }

        self.sink = Some(sink);
        self.status.state = PlaybackState::Playing;
        self.status.current_track = Some(track.clone());
        self.status.duration = track.duration;
        self.status.position = Duration::ZERO;

        Ok(())
    }

    /// Pauses active playback.
    fn pause(&mut self) {
        if self.status.state == PlaybackState::Playing {
            if let Some(sink) = &self.sink {
                sink.pause();
            }
            self.status.state = PlaybackState::Paused;
        }
    }

    /// Resumes paused playback.
    fn resume(&mut self) {
        if self.status.state == PlaybackState::Paused {
            if let Some(sink) = &self.sink {
                sink.play();
            }
            self.status.state = PlaybackState::Playing;
        }
    }

    /// Stops playback, clears active sink, and resets position.
    fn stop(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.status.state = PlaybackState::Stopped;
        self.status.position = Duration::ZERO;
    }

    /// Seeks playback position to the given duration offset.
    fn seek(&mut self, position: Duration) -> Result<(), AudioError> {
        let clamped = position.min(self.status.duration);

        if let Some(sink) = &self.sink {
            if let Err(err) = sink.try_seek(clamped) {
                tracing::warn!("Sink try_seek failed: {err:?}");
                return Err(AudioError::SeekError {
                    position: clamped,
                    reason: err.to_string(),
                });
            }
        }

        self.status.position = clamped;
        Ok(())
    }

    /// Sets playback volume in range [0.0, 1.0].
    fn set_volume(&mut self, volume: f32) {
        let clamped = volume.clamp(0.0, 1.0);
        self.status.volume = clamped;

        if !self.status.is_muted {
            if let Some(sink) = &self.sink {
                sink.set_volume(clamped);
            }
        }
    }

    /// Sets mute state.
    fn set_muted(&mut self, muted: bool) {
        self.status.is_muted = muted;
        if let Some(sink) = &self.sink {
            if muted {
                sink.set_volume(0.0);
            } else {
                sink.set_volume(self.status.volume.clamp(0.0, 1.0));
            }
        }
    }

    /// Toggles mute state.
    fn toggle_mute(&mut self) {
        let next_muted = !self.status.is_muted;
        self.set_muted(next_muted);
    }

    /// Sets the repeat / loop mode.
    fn set_loop_mode(&mut self, mode: LoopMode) {
        self.status.loop_mode = mode;
    }

    /// Sets shuffle flag.
    fn set_shuffle(&mut self, shuffle: bool) {
        self.status.shuffle = shuffle;
    }

    /// Updates internal snapshot and returns a clone of the current [`PlaybackStatus`].
    fn get_status(&mut self) -> PlaybackStatus {
        if self.status.state == PlaybackState::Playing {
            if let Some(sink) = &self.sink {
                if sink.empty() {
                    if self.status.loop_mode != LoopMode::Track {
                        self.status.state = PlaybackState::Stopped;
                        self.status.position = self.status.duration;
                    }
                } else {
                    let pos = sink.get_pos();
                    if self.status.duration > Duration::ZERO {
                        self.status.position = pos.min(self.status.duration);
                    } else {
                        self.status.position = pos;
                    }
                }
            }
        }
        self.status.clone()
    }
}

/// Native Rodio-backed audio playback engine implementing [`AudioBackend`].
///
/// Thread-safe (`Send + Sync`) and designed to handle device absence and track transitions gracefully.
pub struct AudioEngine {
    inner: Mutex<AudioEngineInner>,
}

impl Default for AudioEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for AudioEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let status = self.get_status();
        f.debug_struct("AudioEngine")
            .field("status", &status)
            .finish()
    }
}

impl AudioEngine {
    /// Creates a new [`AudioEngine`] instance, attempting default audio output stream discovery.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(AudioEngineInner::new()),
        }
    }

    /// Helper to safely acquire inner mutex guard, handling poisoned mutexes.
    fn lock(&self) -> MutexGuard<'_, AudioEngineInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Toggles mute status.
    pub fn toggle_mute(&mut self) {
        self.lock().toggle_mute();
    }

    /// Explicitly sets mute state.
    pub fn set_muted(&mut self, muted: bool) {
        self.lock().set_muted(muted);
    }

    /// Returns whether playback is currently muted.
    pub fn is_muted(&self) -> bool {
        self.lock().status.is_muted
    }

    /// Returns whether audio device is currently initialized.
    pub fn has_device(&self) -> bool {
        self.lock().device.is_some()
    }

    /// Returns whether a sink is currently active.
    pub fn has_active_sink(&self) -> bool {
        self.lock().sink.is_some()
    }
}

impl AudioBackend for AudioEngine {
    fn play(&mut self, track: &Track) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.lock()
            .play_track(track)
            .map_err(|err| Box::new(err) as Box<dyn std::error::Error + Send + Sync>)
    }

    fn pause(&mut self) {
        self.lock().pause();
    }

    fn resume(&mut self) {
        self.lock().resume();
    }

    fn stop(&mut self) {
        self.lock().stop();
    }

    fn seek(&mut self, position: Duration) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.lock()
            .seek(position)
            .map_err(|err| Box::new(err) as Box<dyn std::error::Error + Send + Sync>)
    }

    fn set_volume(&mut self, volume: f32) {
        self.lock().set_volume(volume);
    }

    fn set_loop_mode(&mut self, mode: LoopMode) {
        self.lock().set_loop_mode(mode);
    }

    fn set_shuffle(&mut self, shuffle: bool) {
        self.lock().set_shuffle(shuffle);
    }

    fn get_status(&self) -> PlaybackStatus {
        self.lock().get_status()
    }
}
