use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{BufferSize, SampleFormat, Stream, StreamConfig};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::broadcast;

use crate::audio::device::{convert_f32_to_i16, convert_f32_to_u16, OutputDeviceManager};
use crate::audio::dto::{
    AudioDeviceDTO, AudioEvent, AudioTrack, CrossfadeConfig, EqConfig, EqPreset, PlaybackProgress,
    PlaybackState, PlayerSnapshot, RepeatMode, ReplayGainConfig,
};
use crate::audio::error::{AudioError, AudioResult};
use crate::audio::pipeline::{
    device_buffer_frames, realtime_fill, spawn_decode_thread, AudioPipeline, DecodeCommand,
};
use crate::audio::queue::PlaybackQueue;
use crate::sync_util::{recover_mutex, recover_rw_read, recover_rw_write};

use ringbuf::HeapCons;

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

struct InnerPlayerState {
    state: PlaybackState,
    volume: f32,
    is_muted: bool,
    queue: PlaybackQueue,
    eq_config: EqConfig,
    crossfade_config: CrossfadeConfig,
    replay_gain_config: ReplayGainConfig,
    active_device: Option<AudioDeviceDTO>,
    quality_badge: Option<crate::audio::dto::QualityBadge>,
}

pub struct AudioPlayer {
    inner: Arc<RwLock<InnerPlayerState>>,
    device_manager: Arc<Mutex<OutputDeviceManager>>,
    event_sender: broadcast::Sender<AudioEvent>,
    active_stream: Arc<Mutex<Option<Stream>>>,
    pending_cons: Mutex<Option<HeapCons<f32>>>,
    pipeline: Arc<AudioPipeline>,
    decode_tx: crossbeam_channel::Sender<DecodeCommand>,
}

unsafe impl Send for AudioPlayer {}
unsafe impl Sync for AudioPlayer {}

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
            eq_config: default_eq,
            crossfade_config: default_crossfade,
            replay_gain_config: default_rg,
            active_device: None,
            quality_badge: None,
        };

        let (pipeline, cons, decode_tx, decode_rx) = AudioPipeline::create();
        spawn_decode_thread(Arc::clone(&pipeline), decode_rx, event_sender.clone());

        Self {
            inner: Arc::new(RwLock::new(inner_state)),
            device_manager: Arc::new(Mutex::new(OutputDeviceManager::new())),
            event_sender,
            active_stream: Arc::new(Mutex::new(None)),
            pending_cons: Mutex::new(Some(cons)),
            pipeline,
            decode_tx,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AudioEvent> {
        self.event_sender.subscribe()
    }

    pub fn emit_event(&self, event: AudioEvent) {
        let _ = self.event_sender.send(event);
    }

    fn send_decode(&self, cmd: DecodeCommand) {
        if let Err(err) = self.decode_tx.send(cmd) {
            tracing::warn!("Decode thread command dropped: {err}");
        }
    }

    pub fn get_snapshot(&self) -> PlayerSnapshot {
        let inner = recover_rw_read(&self.inner);
        let pos_ms = self.pipeline.position_ms.load(Ordering::Relaxed);
        let curr_track = inner.queue.current_track().cloned();
        let duration_ms = self
            .pipeline
            .duration_ms
            .load(Ordering::Relaxed)
            .max(curr_track.as_ref().map(|t| t.duration_ms).unwrap_or(0));
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

    /// Cheap progress read for the UI ticker: atomics only, no queue clone.
    pub fn get_progress_tick(&self) -> Option<(u64, u64)> {
        if !self.pipeline.is_playing.load(Ordering::Relaxed) {
            return None;
        }
        Some((
            self.pipeline.position_ms.load(Ordering::Relaxed),
            self.pipeline.duration_ms.load(Ordering::Relaxed),
        ))
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
            let mut inner = recover_rw_write(&self.inner);
            inner.queue.clear();
            inner.queue.add_track(track);
            self.emit_queue_updated(&inner);
        }
        self.start_playback_for_current()
    }

    /// Replace the whole queue and start playback at `start_index`.
    /// This is the primary entry point used by the UI so the backend queue owns
    /// next/previous, weighted shuffle and gapless preloading.
    pub fn play_queue(&self, tracks: Vec<AudioTrack>, start_index: usize) -> AudioResult<()> {
        if tracks.is_empty() {
            return Err(AudioError::QueueEmpty);
        }
        let index = start_index.min(tracks.len() - 1);
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.queue.clear();
            inner.queue.add_tracks(tracks);
            inner.queue.set_current_index(index)?;
            self.emit_queue_updated(&inner);
        }
        self.start_playback_for_current()
    }

    /// Called when the decode thread gaplessly moved to the preloaded track:
    /// advance the queue index to match and preload the following track.
    pub fn handle_track_transitioned(&self, track: &AudioTrack) {
        {
            let mut inner = recover_rw_write(&self.inner);
            let advanced_id = inner.queue.next().map(|t| t.id.clone());
            if advanced_id.as_deref() != Some(track.id.as_str()) {
                // Queue mutated after the preload was issued; align to what is
                // actually playing if it is still present in the queue.
                let idx = inner
                    .queue
                    .tracks()
                    .iter()
                    .position(|t| t.id == track.id);
                if let Some(idx) = idx {
                    let _ = inner.queue.set_current_index(idx);
                }
            }
            inner.state = PlaybackState::Playing;
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
    }

    pub fn play_current(&self) -> AudioResult<()> {
        let has_track = recover_rw_read(&self.inner).queue.current_track().is_some();
        if has_track {
            self.start_playback_for_current()
        } else {
            Err(AudioError::QueueEmpty)
        }
    }

    pub fn pause(&self) -> AudioResult<()> {
        let mut inner = recover_rw_write(&self.inner);
        if inner.state == PlaybackState::Playing {
            inner.state = PlaybackState::Paused;
            self.pipeline.is_playing.store(false, Ordering::SeqCst);
            self.emit_event(AudioEvent::StateChanged(PlaybackState::Paused));
        }
        Ok(())
    }

    pub fn resume(&self) -> AudioResult<()> {
        let state = recover_rw_read(&self.inner).state;
        if state == PlaybackState::Paused {
            {
                let mut inner = recover_rw_write(&self.inner);
                inner.state = PlaybackState::Playing;
            }
            self.pipeline.is_playing.store(true, Ordering::SeqCst);
            self.emit_event(AudioEvent::StateChanged(PlaybackState::Playing));
            Ok(())
        } else if state == PlaybackState::Stopped {
            self.play_current()
        } else {
            Ok(())
        }
    }

    pub fn toggle_play_pause(&self) -> AudioResult<()> {
        let state = recover_rw_read(&self.inner).state;
        match state {
            PlaybackState::Playing => self.pause(),
            PlaybackState::Paused => self.resume(),
            PlaybackState::Stopped | PlaybackState::Ended => self.play_current(),
            PlaybackState::Buffering => Ok(()),
        }
    }

    pub fn stop(&self) -> AudioResult<()> {
        let generation = self.pipeline.next_generation();
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.state = PlaybackState::Stopped;
        }
        self.pipeline.is_playing.store(false, Ordering::SeqCst);
        self.pipeline.position_ms.store(0, Ordering::SeqCst);
        self.send_decode(DecodeCommand::Stop { generation });

        self.emit_event(AudioEvent::StateChanged(PlaybackState::Stopped));
        self.emit_event(AudioEvent::ProgressUpdated(PlaybackProgress::default()));
        Ok(())
    }

    pub fn seek(&self, position_ms: u64) -> AudioResult<()> {
        let generation = self.pipeline.generation.load(Ordering::SeqCst);
        self.send_decode(DecodeCommand::Seek {
            position_ms,
            generation,
        });
        Ok(())
    }

    pub fn next(&self) -> AudioResult<()> {
        let next_track = {
            let mut inner = recover_rw_write(&self.inner);
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
        let pos = self.pipeline.position_ms.load(Ordering::Relaxed);
        if pos > 3000 {
            return self.seek(0);
        }

        let prev_track = {
            let mut inner = recover_rw_write(&self.inner);
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
        self.pipeline
            .volume_bits
            .store(clamped.to_bits(), Ordering::Relaxed);
        let is_muted = {
            let mut inner = recover_rw_write(&self.inner);
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
        self.pipeline.is_muted.store(muted, Ordering::Relaxed);
        let volume = {
            let mut inner = recover_rw_write(&self.inner);
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
            let mut inner = recover_rw_write(&self.inner);
            inner.is_muted = !inner.is_muted;
            (inner.volume, inner.is_muted)
        };
        self.pipeline.is_muted.store(muted, Ordering::Relaxed);
        self.emit_event(AudioEvent::VolumeChanged {
            volume: vol,
            is_muted: muted,
        });
        Ok(())
    }

    pub fn set_repeat_mode(&self, mode: RepeatMode) -> AudioResult<()> {
        recover_rw_write(&self.inner).queue.set_repeat_mode(mode);
        self.emit_event(AudioEvent::RepeatModeChanged(mode));
        // The upcoming track may have changed (repeat one/all wrap-around).
        self.check_and_preload_next();
        Ok(())
    }

    pub fn set_shuffle(&self, enabled: bool) -> AudioResult<()> {
        recover_rw_write(&self.inner)
            .queue
            .set_shuffle_enabled(enabled);
        self.emit_event(AudioEvent::ShuffleChanged(enabled));
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_add(&self, tracks: Vec<AudioTrack>) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.queue.add_tracks(tracks);
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_insert(&self, index: usize, track: AudioTrack) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.queue.insert_track(index, track)?;
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_play_next(&self, track: AudioTrack) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.queue.play_next(track);
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_remove(&self, index: usize) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.queue.remove_track(index)?;
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_reorder(&self, from: usize, to: usize) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.queue.reorder(from, to)?;
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_clear(&self) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.queue.clear();
            self.emit_queue_updated(&inner);
        }
        self.stop()
    }

    /// Clear everything except the currently playing track (playback continues).
    pub fn queue_clear_upcoming(&self) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            let current = inner.queue.current_track().cloned();
            inner.queue.clear();
            if let Some(track) = current {
                inner.queue.add_track(track);
            }
            self.emit_queue_updated(&inner);
        }
        self.check_and_preload_next();
        Ok(())
    }

    pub fn queue_set_index(&self, index: usize) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.queue.set_current_index(index)?;
            self.emit_queue_updated(&inner);
        }
        self.start_playback_for_current()
    }

    pub fn set_eq_config(&self, config: EqConfig) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.eq_config = config.clone();
        }
        self.send_decode(DecodeCommand::SetEq(config));
        Ok(())
    }

    pub fn set_eq_preset(&self, preset: EqPreset) -> AudioResult<()> {
        let config = {
            let mut inner = recover_rw_write(&self.inner);
            inner.eq_config.apply_preset(preset);
            inner.eq_config.clone()
        };
        self.send_decode(DecodeCommand::SetEq(config));
        Ok(())
    }

    pub fn set_eq_band(&self, index: usize, gain_db: f32) -> AudioResult<()> {
        let config = {
            let mut inner = recover_rw_write(&self.inner);
            if let Some(band) = inner.eq_config.bands.get_mut(index) {
                band.gain_db = gain_db.clamp(-12.0, 12.0);
                inner.eq_config.preset = EqPreset::Custom;
            }
            inner.eq_config.clone()
        };
        self.send_decode(DecodeCommand::SetEq(config));
        Ok(())
    }

    pub fn set_crossfade_config(&self, config: CrossfadeConfig) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.crossfade_config = config.clone();
        }
        self.send_decode(DecodeCommand::SetCrossfade(config));
        Ok(())
    }

    pub fn set_replay_gain_config(&self, config: ReplayGainConfig) -> AudioResult<()> {
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.replay_gain_config = config.clone();
        }
        self.send_decode(DecodeCommand::SetReplayGain(config));
        Ok(())
    }

    pub fn enumerate_devices(&self) -> AudioResult<Vec<AudioDeviceDTO>> {
        recover_mutex(&self.device_manager).enumerate_devices()
    }

    pub fn select_output_device(&self, device_name: Option<String>) -> AudioResult<()> {
        recover_mutex(&self.device_manager).select_device(device_name);
        let is_playing = self.pipeline.is_playing.load(Ordering::SeqCst);
        self.recreate_cpal_stream()?;
        if is_playing {
            self.pipeline.is_playing.store(true, Ordering::SeqCst);
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
        // plan_next (not peek_next) pins the shuffle pick so the preloaded track
        // is the one a later queue.next() actually resolves to.
        let next_track = recover_rw_write(&self.inner).queue.plan_next().cloned();
        match next_track {
            Some(track) => {
                let generation = self.pipeline.generation.load(Ordering::SeqCst);
                self.send_decode(DecodeCommand::PreloadNext { track, generation });
            }
            // No upcoming track: drop any stale preload so it can't play at EOF.
            None => self.send_decode(DecodeCommand::ClearPreload),
        }
    }

    fn start_playback_for_current(&self) -> AudioResult<()> {
        let track = recover_rw_read(&self.inner)
            .queue
            .current_track()
            .cloned()
            .ok_or(AudioError::QueueEmpty)?;

        let generation = self.pipeline.next_generation();
        {
            let mut inner = recover_rw_write(&self.inner);
            inner.state = PlaybackState::Playing;
        }
        if track.duration_ms > 0 {
            self.pipeline
                .duration_ms
                .store(track.duration_ms, Ordering::Relaxed);
        }
        self.pipeline.is_playing.store(true, Ordering::SeqCst);
        self.pipeline.position_ms.store(0, Ordering::SeqCst);
        self.emit_event(AudioEvent::TrackChanged(Some(track.clone())));
        self.emit_event(AudioEvent::StateChanged(PlaybackState::Playing));
        self.send_decode(DecodeCommand::OpenTrack { track, generation });
        self.check_and_preload_next();
        self.init_cpal_stream()?;
        Ok(())
    }

    fn recreate_cpal_stream(&self) -> AudioResult<()> {
        {
            let mut stream_lock = recover_mutex(&self.active_stream);
            *stream_lock = None;
        }
        let cons = self.pipeline.recreate_ring();
        *recover_mutex(&self.pending_cons) = Some(cons);
        self.init_cpal_stream()
    }

    fn init_cpal_stream(&self) -> AudioResult<()> {
        let mut stream_lock = recover_mutex(&self.active_stream);
        if stream_lock.is_some() {
            return Ok(());
        }

        let cons = recover_mutex(&self.pending_cons)
            .take()
            .unwrap_or_else(|| self.pipeline.recreate_ring());

        let device = recover_mutex(&self.device_manager).get_active_device()?;
        let supported_config = OutputDeviceManager::get_best_output_config(&device)?;
        let sample_format = supported_config.sample_format();
        let mut config: StreamConfig = supported_config.into();
        let sample_rate = config.sample_rate.0;
        let channels = config.channels;
        config.buffer_size = BufferSize::Fixed(device_buffer_frames(sample_rate));

        self.pipeline
            .sample_rate
            .store(sample_rate, Ordering::Relaxed);
        self.pipeline
            .channels
            .store(channels as u32, Ordering::Relaxed);
        self.send_decode(DecodeCommand::SetOutputSpec {
            sample_rate,
            channels,
        });

        let pipeline = Arc::clone(&self.pipeline);
        let err_event_sender = self.event_sender.clone();
        let err_fn = move |err: cpal::StreamError| {
            tracing::error!("CPAL audio stream error: {}", err);
            let _ = err_event_sender.send(AudioEvent::DeviceLost(err.to_string()));
        };

        let stream =
            match self.build_stream(&device, &config, sample_format, cons, pipeline, err_fn) {
                Ok(stream) => stream,
                Err(_) if matches!(config.buffer_size, BufferSize::Fixed(_)) => {
                    config.buffer_size = BufferSize::Default;
                    let pipeline = Arc::clone(&self.pipeline);
                    let err_event_sender = self.event_sender.clone();
                    let err_fn = move |err: cpal::StreamError| {
                        tracing::error!("CPAL audio stream error: {}", err);
                        let _ = err_event_sender.send(AudioEvent::DeviceLost(err.to_string()));
                    };
                    let cons = self.pipeline.recreate_ring();
                    self.build_stream(&device, &config, sample_format, cons, pipeline, err_fn)?
                }
                Err(err) => return Err(err),
            };

        stream
            .play()
            .map_err(|e| AudioError::StreamError(e.to_string()))?;
        *stream_lock = Some(stream);
        Ok(())
    }

    fn build_stream<E>(
        &self,
        device: &cpal::Device,
        config: &StreamConfig,
        sample_format: SampleFormat,
        mut cons: HeapCons<f32>,
        pipeline: Arc<AudioPipeline>,
        err_fn: E,
    ) -> AudioResult<Stream>
    where
        E: FnMut(cpal::StreamError) + Send + 'static,
    {
        let stream = match sample_format {
            SampleFormat::F32 => device.build_output_stream(
                config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    realtime_fill(data, &mut cons, &pipeline);
                },
                err_fn,
                None,
            ),
            SampleFormat::I16 => device.build_output_stream(
                config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    let mut tmp = [0.0f32; 512];
                    for chunk in data.chunks_mut(512) {
                        let sl = &mut tmp[..chunk.len()];
                        realtime_fill(sl, &mut cons, &pipeline);
                        for (out, &sample) in chunk.iter_mut().zip(sl.iter()) {
                            *out = convert_f32_to_i16(sample);
                        }
                    }
                },
                err_fn,
                None,
            ),
            SampleFormat::U16 => device.build_output_stream(
                config,
                move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                    let mut tmp = [0.0f32; 512];
                    for chunk in data.chunks_mut(512) {
                        let sl = &mut tmp[..chunk.len()];
                        realtime_fill(sl, &mut cons, &pipeline);
                        for (out, &sample) in chunk.iter_mut().zip(sl.iter()) {
                            *out = convert_f32_to_u16(sample);
                        }
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
        Ok(stream)
    }
}

impl Drop for AudioPlayer {
    fn drop(&mut self) {
        self.pipeline.is_playing.store(false, Ordering::SeqCst);
        let _ = self.decode_tx.send(DecodeCommand::Shutdown);
        let mut stream = recover_mutex(&self.active_stream);
        *stream = None;
    }
}
