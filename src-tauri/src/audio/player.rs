use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use tokio::sync::broadcast;

use crate::audio::adapters::{
    FallbackMediaControlsAdapter, MediaControlsAdapter, StandardAudioAdapter,
};
use crate::audio::decoder::AudioDecoder;
use crate::audio::device::{convert_f32_to_i16, convert_f32_to_u16, OutputDeviceManager};
use crate::audio::dsp::{soft_limit, CrossfadeProcessor, EqualizerProcessor, ReplayGainProcessor};
use crate::audio::dto::{
    AudioDeviceDTO, AudioEvent, AudioTrack, CrossfadeConfig, EqBand, EqConfig, EqPreset,
    PlaybackProgress, PlaybackState, PlayerSnapshot, QualityBadge, RepeatMode, ReplayGainConfig,
};
use crate::audio::error::{AudioError, AudioResult};
use crate::audio::gapless::GaplessController;
use crate::audio::queue::PlaybackQueue;

/// Commands sent from UI/Tauri command handlers to the audio engine
#[derive(Debug)]
pub enum AudioCommand {
    PlayTrack(AudioTrack),
    PlayCurrent,
    Pause,
    Resume,
    Stop,
    TogglePlayPause,
    Seek(u64),
    Next,
    Previous,
    SetVolume(f32),
    SetMuted(bool),
    ToggleMute,
    SetRepeatMode(RepeatMode),
    SetShuffle(bool),
    QueueAdd(Vec<AudioTrack>),
    QueueInsert(usize, AudioTrack),
    QueuePlayNext(AudioTrack),
    QueueRemove(usize),
    QueueReorder(usize, usize),
    QueueClear,
    QueueSetIndex(usize),
    SetEqConfig(EqConfig),
    SetEqPreset(EqPreset),
    SetEqBand(usize, f32),
    SetCrossfadeConfig(CrossfadeConfig),
    SetReplayGainConfig(ReplayGainConfig),
    SelectDevice(Option<String>),
}

/// Internal shared audio player state
struct InnerPlayerState {
    state: PlaybackState,
    volume: f32,
    is_muted: bool,
    queue: PlaybackQueue,
    eq_config: EqConfig,
    crossfade_config: CrossfadeConfig,
    replay_gain_config: ReplayGainConfig,
    active_device: Option<AudioDeviceDTO>,
    quality_badge: Option<QualityBadge>,
}

/// Production Native Tauri Audio Player
pub struct AudioPlayer {
    inner: Arc<RwLock<InnerPlayerState>>,
    gapless_controller: Arc<Mutex<GaplessController>>,
    eq_processor: Arc<Mutex<EqualizerProcessor>>,
    replay_gain_processor: Arc<Mutex<ReplayGainProcessor>>,
    crossfade_processor: Arc<Mutex<CrossfadeProcessor>>,
    device_manager: Arc<Mutex<OutputDeviceManager>>,
    event_sender: broadcast::Sender<AudioEvent>,
    active_stream: Arc<Mutex<Option<Stream>>>,
    is_playing_atomic: Arc<AtomicBool>,
    current_position_ms_atomic: Arc<AtomicU64>,
}

impl Default for AudioPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioPlayer {
    pub fn new() -> Self {
        let (event_sender, _) = broadcast::channel(256);

        let default_eq = EqConfig::default();
        let default_crossfade = CrossfadeConfig::default();
        let default_rg = ReplayGainConfig::default();

        let inner_state = InnerPlayerState {
            state: PlaybackState::Stopped,
            volume: 1.0,
            is_muted: false,
            queue: PlaybackQueue::new(),
            eq_config: default_eq.clone(),
            crossfade_config: default_crossfade.clone(),
            replay_gain_config: default_rg.clone(),
            active_device: None,
            quality_badge: None,
        };

        let gapless = GaplessController::new(44100, 2);
        let eq_proc = EqualizerProcessor::new(44100, 2, &default_eq);
        let rg_proc = ReplayGainProcessor::new();
        let cf_proc = CrossfadeProcessor::new(44100, 2, default_crossfade);
        let dev_mgr = OutputDeviceManager::new();

        let player = Self {
            inner: Arc::new(RwLock::new(inner_state)),
            gapless_controller: Arc::new(Mutex::new(gapless)),
            eq_processor: Arc::new(Mutex::new(eq_proc)),
            replay_gain_processor: Arc::new(Mutex::new(rg_proc)),
            crossfade_processor: Arc::new(Mutex::new(cf_proc)),
            device_manager: Arc::new(Mutex::new(dev_mgr)),
            event_sender,
            active_stream: Arc::new(Mutex::new(None)),
            is_playing_atomic: Arc::new(AtomicBool::new(false)),
            current_position_ms_atomic: Arc::new(AtomicU64::new(0)),
        };

        player
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AudioEvent> {
        self.event_sender.subscribe()
    }

    pub fn emit_event(&self, event: AudioEvent) {
        let _ = self.event_sender.send(event);
    }

    pub fn get_snapshot(&self) -> PlayerSnapshot {
        let inner = self.inner.read().unwrap();
        let pos_ms = self.current_position_ms_atomic.load(Ordering::Relaxed);
        let curr_track = inner.queue.current_track().cloned();
        let duration_ms = curr_track.as_ref().map(|t| t.duration_ms).unwrap_or(0);
        let percentage = if duration_ms > 0 {
            (pos_ms as f32 / duration_ms as f32).clamp(0.0, 1.0)
        } else {
            0.0
        };

        PlayerSnapshot {
            state: inner.state,
            current_track: curr_track,
            progress: PlaybackProgress {
                position_ms: pos_ms,
                duration_ms,
                buffered_ms: pos_ms,
                percentage,
            },
            volume: inner.volume,
            is_muted: inner.is_muted,
            repeat_mode: inner.queue.repeat_mode(),
            shuffle_enabled: inner.queue.shuffle_enabled(),
            queue: inner.queue.tracks().to_vec(),
            queue_index: inner.queue.current_index(),
            quality_badge: inner.quality_badge.clone(),
            eq: inner.eq_config.clone(),
            crossfade: inner.crossfade_config.clone(),
            replay_gain: inner.replay_gain_config.clone(),
            output_device: inner.active_device.clone(),
        }
    }

    pub fn execute_command(&self, command: AudioCommand) -> AudioResult<()> {
        match command {
            AudioCommand::PlayTrack(track) => self.play_track(track),
            AudioCommand::PlayCurrent => self.play_current(),
            AudioCommand::Pause => self.pause(),
            AudioCommand::Resume => self.resume(),
            AudioCommand::Stop => self.stop(),
            AudioCommand::TogglePlayPause => self.toggle_play_pause(),
            AudioCommand::Seek(pos) => self.seek(pos),
            AudioCommand::Next => self.next(),
            AudioCommand::Previous => self.previous(),
            AudioCommand::SetVolume(vol) => self.set_volume(vol),
            AudioCommand::SetMuted(muted) => self.set_muted(muted),
            AudioCommand::ToggleMute => self.toggle_mute(),
            AudioCommand::SetRepeatMode(mode) => self.set_repeat_mode(mode),
            AudioCommand::SetShuffle(enabled) => self.set_shuffle(enabled),
            AudioCommand::QueueAdd(tracks) => self.queue_add(tracks),
            AudioCommand::QueueInsert(idx, track) => self.queue_insert(idx, track),
            AudioCommand::QueuePlayNext(track) => self.queue_play_next(track),
            AudioCommand::QueueRemove(idx) => self.queue_remove(idx),
            AudioCommand::QueueReorder(from, to) => self.queue_reorder(from, to),
            AudioCommand::QueueClear => self.queue_clear(),
            AudioCommand::QueueSetIndex(idx) => self.queue_set_index(idx),
            AudioCommand::SetEqConfig(cfg) => self.set_eq_config(cfg),
            AudioCommand::SetEqPreset(preset) => self.set_eq_preset(preset),
            AudioCommand::SetEqBand(idx, gain) => self.set_eq_band(idx, gain),
            AudioCommand::SetCrossfadeConfig(cfg) => self.set_crossfade_config(cfg),
            AudioCommand::SetReplayGainConfig(cfg) => self.set_replay_gain_config(cfg),
            AudioCommand::SelectDevice(dev) => self.select_output_device(dev),
        }
    }

    pub fn play_track(&self, track: AudioTrack) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.clear();
            inner.queue.add_track(track.clone());
        }
        self.start_playback_for_current()
    }

    pub fn play_current(&self) -> AudioResult<()> {
        let current_track = {
            let inner = self.inner.read().unwrap();
            inner.queue.current_track().cloned()
        };

        if let Some(_) = current_track {
            self.start_playback_for_current()
        } else {
            Err(AudioError::QueueEmpty)
        }
    }

    pub fn pause(&self) -> AudioResult<()> {
        let mut inner = self.inner.write().unwrap();
        if inner.state == PlaybackState::Playing {
            inner.state = PlaybackState::Paused;
            self.is_playing_atomic.store(false, Ordering::SeqCst);
            self.emit_event(AudioEvent::StateChanged(PlaybackState::Paused));
        }
        Ok(())
    }

    pub fn resume(&self) -> AudioResult<()> {
        let state = { self.inner.read().unwrap().state };
        if state == PlaybackState::Paused {
            {
                let mut inner = self.inner.write().unwrap();
                inner.state = PlaybackState::Playing;
            }
            self.is_playing_atomic.store(true, Ordering::SeqCst);
            self.emit_event(AudioEvent::StateChanged(PlaybackState::Playing));
            Ok(())
        } else if state == PlaybackState::Stopped {
            self.play_current()
        } else {
            Ok(())
        }
    }

    pub fn toggle_play_pause(&self) -> AudioResult<()> {
        let state = { self.inner.read().unwrap().state };
        match state {
            PlaybackState::Playing => self.pause(),
            PlaybackState::Paused => self.resume(),
            PlaybackState::Stopped | PlaybackState::Ended => self.play_current(),
            PlaybackState::Buffering => Ok(()),
        }
    }

    pub fn stop(&self) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.state = PlaybackState::Stopped;
        }
        self.is_playing_atomic.store(false, Ordering::SeqCst);
        self.current_position_ms_atomic.store(0, Ordering::SeqCst);

        // Clear active stream
        let mut stream_lock = self.active_stream.lock().unwrap();
        *stream_lock = None;

        self.emit_event(AudioEvent::StateChanged(PlaybackState::Stopped));
        self.emit_event(AudioEvent::ProgressUpdated(PlaybackProgress::default()));
        Ok(())
    }

    pub fn seek(&self, position_ms: u64) -> AudioResult<()> {
        let mut gapless = self.gapless_controller.lock().unwrap();
        if gapless.has_current() {
            let actual = gapless.seek(position_ms)?;
            self.current_position_ms_atomic
                .store(actual, Ordering::SeqCst);
            let duration = self
                .inner
                .read()
                .unwrap()
                .queue
                .current_track()
                .map(|t| t.duration_ms)
                .unwrap_or(0);
            let percentage = if duration > 0 {
                (actual as f32 / duration as f32).clamp(0.0, 1.0)
            } else {
                0.0
            };

            self.emit_event(AudioEvent::ProgressUpdated(PlaybackProgress {
                position_ms: actual,
                duration_ms: duration,
                buffered_ms: actual,
                percentage,
            }));
            Ok(())
        } else {
            Ok(())
        }
    }

    pub fn next(&self) -> AudioResult<()> {
        let next_track = {
            let mut inner = self.inner.write().unwrap();
            inner.queue.next().cloned()
        };

        if let Some(track) = next_track {
            self.emit_event(AudioEvent::TrackChanged(Some(track)));
            self.start_playback_for_current()
        } else {
            self.stop()
        }
    }

    pub fn previous(&self) -> AudioResult<()> {
        // If playing > 3 seconds, replay track from beginning
        let pos = self.current_position_ms_atomic.load(Ordering::Relaxed);
        if pos > 3000 {
            return self.seek(0);
        }

        let prev_track = {
            let mut inner = self.inner.write().unwrap();
            inner.queue.previous().cloned()
        };

        if let Some(track) = prev_track {
            self.emit_event(AudioEvent::TrackChanged(Some(track)));
            self.start_playback_for_current()
        } else {
            self.seek(0)
        }
    }

    pub fn set_volume(&self, volume: f32) -> AudioResult<()> {
        let clamped = volume.clamp(0.0, 1.0);
        let is_muted = {
            let mut inner = self.inner.write().unwrap();
            inner.volume = clamped;
            inner.is_muted
        };
        self.emit_event(AudioEvent::VolumeChanged {
            volume: clamped,
            is_muted,
        });
        Ok(())
    }

    pub fn set_muted(&self, muted: bool) -> AudioResult<()> {
        let volume = {
            let mut inner = self.inner.write().unwrap();
            inner.is_muted = muted;
            inner.volume
        };
        self.emit_event(AudioEvent::VolumeChanged {
            volume,
            is_muted: muted,
        });
        Ok(())
    }

    pub fn toggle_mute(&self) -> AudioResult<()> {
        let (vol, muted) = {
            let mut inner = self.inner.write().unwrap();
            inner.is_muted = !inner.is_muted;
            (inner.volume, inner.is_muted)
        };
        self.emit_event(AudioEvent::VolumeChanged {
            volume: vol,
            is_muted: muted,
        });
        Ok(())
    }

    pub fn set_repeat_mode(&self, mode: RepeatMode) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.set_repeat_mode(mode);
        }
        self.emit_event(AudioEvent::RepeatModeChanged(mode));
        Ok(())
    }

    pub fn set_shuffle(&self, enabled: bool) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.set_shuffle_enabled(enabled);
        }
        self.emit_event(AudioEvent::ShuffleChanged(enabled));
        Ok(())
    }

    pub fn queue_add(&self, tracks: Vec<AudioTrack>) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.add_tracks(tracks);
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_insert(&self, index: usize, track: AudioTrack) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.insert_track(index, track)?;
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_play_next(&self, track: AudioTrack) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.play_next(track);
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_remove(&self, index: usize) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.remove_track(index)?;
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_reorder(&self, from: usize, to: usize) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.reorder(from, to)?;
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_clear(&self) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.clear();
            self.emit_queue_updated(&inner);
        }
        self.stop()
    }

    pub fn queue_set_index(&self, index: usize) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.queue.set_current_index(index)?;
            self.emit_queue_updated(&inner);
        }
        self.start_playback_for_current()
    }

    pub fn set_eq_config(&self, config: EqConfig) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.eq_config = config.clone();
        }
        let mut eq = self.eq_processor.lock().unwrap();
        eq.update_config(&config);
        Ok(())
    }

    pub fn set_eq_preset(&self, preset: EqPreset) -> AudioResult<()> {
        let config = {
            let mut inner = self.inner.write().unwrap();
            inner.eq_config.apply_preset(preset);
            inner.eq_config.clone()
        };
        let mut eq = self.eq_processor.lock().unwrap();
        eq.update_config(&config);
        Ok(())
    }

    pub fn set_eq_band(&self, index: usize, gain_db: f32) -> AudioResult<()> {
        let config = {
            let mut inner = self.inner.write().unwrap();
            if let Some(band) = inner.eq_config.bands.get_mut(index) {
                band.gain_db = gain_db.clamp(-12.0, 12.0);
                inner.eq_config.preset = EqPreset::Custom;
            }
            inner.eq_config.clone()
        };
        let mut eq = self.eq_processor.lock().unwrap();
        eq.update_config(&config);
        Ok(())
    }

    pub fn set_crossfade_config(&self, config: CrossfadeConfig) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.crossfade_config = config.clone();
        }
        let mut cf = self.crossfade_processor.lock().unwrap();
        cf.set_config(config);
        Ok(())
    }

    pub fn set_replay_gain_config(&self, config: ReplayGainConfig) -> AudioResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            inner.replay_gain_config = config.clone();
        }
        let mut rg = self.replay_gain_processor.lock().unwrap();
        let gapless = self.gapless_controller.lock().unwrap();
        rg.update(&config, gapless.current_replay_gain().as_ref());
        Ok(())
    }

    pub fn enumerate_devices(&self) -> AudioResult<Vec<AudioDeviceDTO>> {
        let dev_mgr = self.device_manager.lock().unwrap();
        dev_mgr.enumerate_devices()
    }

    pub fn select_output_device(&self, device_name: Option<String>) -> AudioResult<()> {
        {
            let mut dev_mgr = self.device_manager.lock().unwrap();
            dev_mgr.select_device(device_name.clone());
        }

        // If currently playing, recreate audio stream on new device
        let is_playing = self.is_playing_atomic.load(Ordering::SeqCst);
        if is_playing {
            self.start_playback_for_current()?;
        }
        Ok(())
    }

    fn emit_queue_updated(&self, inner: &InnerPlayerState) {
        self.emit_event(AudioEvent::QueueUpdated {
            queue: inner.queue.tracks().to_vec(),
            current_index: inner.queue.current_index(),
        });
    }

    fn check_and_preload_next(&self) {
        let next_track_opt = {
            let inner = self.inner.read().unwrap();
            inner.queue.peek_next().cloned()
        };

        if let Some(next_track) = next_track_opt {
            let mut gapless = self.gapless_controller.lock().unwrap();
            let _ = gapless.preload_next(next_track);
        }
    }

    fn start_playback_for_current(&self) -> AudioResult<()> {
        let current_track = {
            let inner = self.inner.read().unwrap();
            inner.queue.current_track().cloned()
        };

        let track = match current_track {
            Some(t) => t,
            None => return Err(AudioError::QueueEmpty),
        };

        // Load into gapless controller
        {
            let mut gapless = self.gapless_controller.lock().unwrap();
            gapless.load_track(track.clone())?;
        }

        // Update ReplayGain & QualityBadge
        {
            let gapless = self.gapless_controller.lock().unwrap();
            let badge = gapless.current_quality_badge();
            let rg_info = gapless.current_replay_gain();

            let mut inner = self.inner.write().unwrap();
            inner.quality_badge = badge.clone();
            inner.state = PlaybackState::Playing;

            let mut rg_proc = self.replay_gain_processor.lock().unwrap();
            rg_proc.update(&inner.replay_gain_config, rg_info.as_ref());

            self.emit_event(AudioEvent::TrackChanged(Some(track.clone())));
            self.emit_event(AudioEvent::QualityUpdated(badge));
            self.emit_event(AudioEvent::StateChanged(PlaybackState::Playing));
        }

        self.is_playing_atomic.store(true, Ordering::SeqCst);
        self.current_position_ms_atomic.store(0, Ordering::SeqCst);

        // Preload next track
        self.check_and_preload_next();

        // Ensure CPAL Stream is running
        self.init_cpal_stream()?;

        Ok(())
    }

    fn init_cpal_stream(&self) -> AudioResult<()> {
        let mut stream_lock = self.active_stream.lock().unwrap();
        if stream_lock.is_some() {
            return Ok(());
        }

        let dev_mgr = self.device_manager.lock().unwrap();
        let device = dev_mgr.get_active_device()?;
        let supported_config = OutputDeviceManager::get_best_output_config(&device)?;
        let sample_format = supported_config.sample_format();
        let config: StreamConfig = supported_config.into();

        let sample_rate = config.sample_rate.0;
        let channels = config.channels;

        // Update DSP and Gapless output specs
        {
            let mut gapless = self.gapless_controller.lock().unwrap();
            gapless.set_output_spec(sample_rate, channels);

            let mut eq = self.eq_processor.lock().unwrap();
            eq.set_sample_rate(sample_rate);
        }

        let gapless_arc = Arc::clone(&self.gapless_controller);
        let eq_arc = Arc::clone(&self.eq_processor);
        let rg_arc = Arc::clone(&self.replay_gain_processor);
        let is_playing_arc = Arc::clone(&self.is_playing_atomic);
        let pos_arc = Arc::clone(&self.current_position_ms_atomic);
        let inner_arc = Arc::clone(&self.inner);
        let event_sender_clone = self.event_sender.clone();

        let err_event_sender = self.event_sender.clone();
        let err_fn = move |err: cpal::StreamError| {
            log::error!("CPAL audio stream error: {}", err);
            let _ = err_event_sender.send(AudioEvent::DeviceLost(err.to_string()));
        };

        let stream = match sample_format {
            SampleFormat::F32 => device.build_output_stream(
                &config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    Self::audio_callback_f32(
                        data,
                        &gapless_arc,
                        &eq_arc,
                        &rg_arc,
                        &is_playing_arc,
                        &pos_arc,
                        &inner_arc,
                        &event_sender_clone,
                    );
                },
                err_fn,
                None,
            ),
            SampleFormat::I16 => device.build_output_stream(
                &config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    let mut temp = vec![0.0f32; data.len()];
                    Self::audio_callback_f32(
                        &mut temp,
                        &gapless_arc,
                        &eq_arc,
                        &rg_arc,
                        &is_playing_arc,
                        &pos_arc,
                        &inner_arc,
                        &event_sender_clone,
                    );
                    for (out, &sample) in data.iter_mut().zip(temp.iter()) {
                        *out = convert_f32_to_i16(sample);
                    }
                },
                err_fn,
                None,
            ),
            SampleFormat::U16 => device.build_output_stream(
                &config,
                move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                    let mut temp = vec![0.0f32; data.len()];
                    Self::audio_callback_f32(
                        &mut temp,
                        &gapless_arc,
                        &eq_arc,
                        &rg_arc,
                        &is_playing_arc,
                        &pos_arc,
                        &inner_arc,
                        &event_sender_clone,
                    );
                    for (out, &sample) in data.iter_mut().zip(temp.iter()) {
                        *out = convert_f32_to_u16(sample);
                    }
                },
                err_fn,
                None,
            ),
            _ => {
                return Err(AudioError::StreamInitialization(
                    "Unsupported CPAL sample format".to_string(),
                ));
            }
        }
        .map_err(|e| AudioError::StreamInitialization(e.to_string()))?;

        stream
            .play()
            .map_err(|e| AudioError::StreamError(e.to_string()))?;
        *stream_lock = Some(stream);

        Ok(())
    }

    fn audio_callback_f32(
        output_buffer: &mut [f32],
        gapless_arc: &Arc<Mutex<GaplessController>>,
        eq_arc: &Arc<Mutex<EqualizerProcessor>>,
        rg_arc: &Arc<Mutex<ReplayGainProcessor>>,
        is_playing_arc: &Arc<AtomicBool>,
        pos_arc: &Arc<AtomicU64>,
        inner_arc: &Arc<RwLock<InnerPlayerState>>,
        event_sender: &broadcast::Sender<AudioEvent>,
    ) {
        if !is_playing_arc.load(Ordering::Relaxed) {
            output_buffer.fill(0.0);
            return;
        }

        let mut gapless = match gapless_arc.try_lock() {
            Ok(g) => g,
            Err(_) => {
                output_buffer.fill(0.0);
                return;
            }
        };

        match gapless.read_samples(output_buffer) {
            Ok((written, transitioned, is_eof)) => {
                if written < output_buffer.len() {
                    output_buffer[written..].fill(0.0);
                }

                let current_pos_ms = gapless.current_position_ms();
                pos_arc.store(current_pos_ms, Ordering::Relaxed);

                if let Some(next_track) = transitioned {
                    let _ = event_sender.send(AudioEvent::TrackChanged(Some(next_track)));
                }

                if is_eof && written == 0 {
                    is_playing_arc.store(false, Ordering::Relaxed);
                    let _ = event_sender.send(AudioEvent::StateChanged(PlaybackState::Ended));
                }
            }
            Err(e) => {
                log::error!("Audio decode error during stream callback: {}", e);
                output_buffer.fill(0.0);
            }
        }

        // Apply ReplayGain
        if let Ok(mut rg) = rg_arc.try_lock() {
            rg.process_interleaved(output_buffer);
        }

        // Apply Equalizer
        if let Ok(mut eq) = eq_arc.try_lock() {
            eq.process_interleaved(output_buffer);
        }

        // Volume & Mute scaling
        let (volume, is_muted) = {
            let inner = inner_arc.read().unwrap();
            (inner.volume, inner.is_muted)
        };

        if is_muted {
            output_buffer.fill(0.0);
        } else if (volume - 1.0).abs() > 0.001 {
            for sample in output_buffer.iter_mut() {
                *sample *= volume;
            }
        }

        // Soft limit to prevent digital distortion
        soft_limit(output_buffer);
    }
}
