//! Lock-free PCM pipeline: decode thread → ring buffer → CPAL callback.
//!
//! The realtime callback must never lock a Mutex, allocate, do I/O, log, or panic.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, TryRecvError};
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use tokio::sync::broadcast;

use crate::audio::dsp::{soft_limit, EqualizerProcessor, ReplayGainProcessor};
use crate::audio::dto::{
    AudioEvent, AudioTrack, CrossfadeConfig, EqConfig, PlaybackProgress, PlaybackState,
    ReplayGainConfig,
};
use crate::audio::gapless::{GaplessController, PreloadedTrack};
use crate::sync_util::recover_mutex;

/// PCM cushion kept in the lock-free ring (200–500ms band).
///
/// 350ms survives UI/library-scan CPU spikes without underruns. The trade-off is
/// ~350ms of extra play/seek/EQ latency, which is acceptable for a music player
/// (not a DAW / live-monitor app).
pub const RING_BUFFER_MS: u32 = 350;

/// Device-side callback period. ~85ms at 48 kHz, clamped to 2048–8192 frames.
/// Combined with [`RING_BUFFER_MS`] this is ~430ms end-to-end latency.
pub const DEVICE_BUFFER_MS: u32 = 85;

/// Capacity for 500ms of 192 kHz stereo (worst reasonable output format).
pub const RING_CAPACITY: usize = 192_000 * 2 * 500 / 1000;

const DECODE_CHUNK: usize = 4096;
const RESET_WAIT: Duration = Duration::from_millis(80);

#[derive(Debug)]
pub enum DecodeCommand {
    OpenTrack { track: AudioTrack, generation: u64 },
    PreloadNext { track: AudioTrack, generation: u64 },
    ClearPreload,
    Seek { position_ms: u64, generation: u64 },
    Stop { generation: u64 },
    SetEq(EqConfig),
    SetCrossfade(CrossfadeConfig),
    SetReplayGain(ReplayGainConfig),
    SetOutputSpec { sample_rate: u32, channels: u16 },
    Shutdown,
}

pub struct AudioPipeline {
    pub producer: Mutex<Option<HeapProd<f32>>>,
    pub pending_reset: AtomicBool,
    pub sample_rate: AtomicU32,
    pub channels: AtomicU32,
    pub position_ms: AtomicU64,
    pub duration_ms: AtomicU64,
    pub samples_played: AtomicU64,
    pub generation: AtomicU64,
    pub is_playing: AtomicBool,
    pub volume_bits: AtomicU32,
    pub is_muted: AtomicBool,
}

impl AudioPipeline {
    pub fn create() -> (
        Arc<Self>,
        HeapCons<f32>,
        Sender<DecodeCommand>,
        Receiver<DecodeCommand>,
    ) {
        let rb = HeapRb::<f32>::new(RING_CAPACITY.max(1024));
        let (prod, cons) = rb.split();
        let (tx, rx) = crossbeam_channel::unbounded();
        let pipeline = Arc::new(Self {
            producer: Mutex::new(Some(prod)),
            pending_reset: AtomicBool::new(false),
            sample_rate: AtomicU32::new(44100),
            channels: AtomicU32::new(2),
            position_ms: AtomicU64::new(0),
            duration_ms: AtomicU64::new(0),
            samples_played: AtomicU64::new(0),
            generation: AtomicU64::new(0),
            is_playing: AtomicBool::new(false),
            volume_bits: AtomicU32::new(1.0f32.to_bits()),
            is_muted: AtomicBool::new(false),
        });
        (pipeline, cons, tx, rx)
    }

    pub fn recreate_ring(&self) -> HeapCons<f32> {
        let rb = HeapRb::<f32>::new(RING_CAPACITY.max(1024));
        let (prod, cons) = rb.split();
        *recover_mutex(&self.producer) = Some(prod);
        cons
    }

    pub fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn is_current(&self, generation: u64) -> bool {
        generation == self.generation.load(Ordering::SeqCst)
    }

    pub fn request_reset(&self) {
        self.pending_reset.store(true, Ordering::Release);
        let deadline = Instant::now() + RESET_WAIT;
        while self.pending_reset.load(Ordering::Acquire) && Instant::now() < deadline {
            thread::sleep(Duration::from_micros(250));
        }
        self.pending_reset.store(false, Ordering::Release);
    }
}

/// Realtime-safe fill. No Mutex::lock, no alloc, no I/O, no tracing, no unwrap.
#[inline]
pub fn realtime_fill(output: &mut [f32], cons: &mut HeapCons<f32>, pipeline: &AudioPipeline) {
    if pipeline.pending_reset.load(Ordering::Acquire) {
        let mut tmp = [0.0f32; 256];
        while cons.pop_slice(&mut tmp) > 0 {}
        pipeline.pending_reset.store(false, Ordering::Release);
        output.fill(0.0);
        return;
    }

    if !pipeline.is_playing.load(Ordering::Relaxed) {
        output.fill(0.0);
        return;
    }

    let written = cons.pop_slice(output);
    if written < output.len() {
        output[written..].fill(0.0);
    }

    let channels = pipeline.channels.load(Ordering::Relaxed) as u64;
    let sample_rate = pipeline.sample_rate.load(Ordering::Relaxed) as u64;
    if channels > 0 && sample_rate > 0 && written > 0 {
        let total = pipeline
            .samples_played
            .fetch_add(written as u64, Ordering::Relaxed)
            + written as u64;
        let frames = total / channels;
        pipeline
            .position_ms
            .store(frames.saturating_mul(1000) / sample_rate, Ordering::Relaxed);
    }

    if pipeline.is_muted.load(Ordering::Relaxed) {
        output.fill(0.0);
        return;
    }

    let volume = f32::from_bits(pipeline.volume_bits.load(Ordering::Relaxed));
    if (volume - 1.0).abs() > 0.001 {
        for sample in output.iter_mut() {
            *sample *= volume;
        }
    }
    soft_limit(output);
}

pub fn spawn_decode_thread(
    pipeline: Arc<AudioPipeline>,
    cmd_rx: Receiver<DecodeCommand>,
    event_tx: broadcast::Sender<AudioEvent>,
) {
    let spawn_result = thread::Builder::new()
        .name("audio-decode".into())
        .spawn(move || {
            crate::sync_util::set_current_thread_priority_high();
            decode_loop(pipeline, cmd_rx, event_tx);
        });
    if let Err(err) = spawn_result {
        tracing::error!("Failed to spawn audio decode thread: {err}");
    }
}

fn decode_loop(
    pipeline: Arc<AudioPipeline>,
    cmd_rx: Receiver<DecodeCommand>,
    event_tx: broadcast::Sender<AudioEvent>,
) {
    let mut gapless = GaplessController::new(44100, 2);
    let mut eq = EqualizerProcessor::new(44100, 2, &EqConfig::default());
    let mut rg = ReplayGainProcessor::new();
    let mut rg_config = ReplayGainConfig::default();
    let mut scratch = vec![0.0f32; DECODE_CHUNK];

    loop {
        let busy = pipeline.is_playing.load(Ordering::Relaxed) && gapless.has_current();
        let cmd = if busy {
            match cmd_rx.try_recv() {
                Ok(cmd) => Some(cmd),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => return,
            }
        } else {
            match cmd_rx.recv_timeout(Duration::from_millis(15)) {
                Ok(cmd) => Some(cmd),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        };

        if let Some(cmd) = cmd {
            match cmd {
                DecodeCommand::Shutdown => return,
                DecodeCommand::OpenTrack { track, generation } => {
                    handle_open(
                        &pipeline,
                        &mut gapless,
                        &mut eq,
                        &mut rg,
                        &rg_config,
                        &event_tx,
                        track,
                        generation,
                    );
                }
                DecodeCommand::PreloadNext { track, generation } => {
                    if pipeline.is_current(generation) {
                        match PreloadedTrack::open(track) {
                            Ok(preloaded) => {
                                if pipeline.is_current(generation) {
                                    gapless.set_preloaded_next(preloaded);
                                }
                            }
                            Err(err) => tracing::warn!("Unable to preload next track: {err}"),
                        }
                    }
                }
                DecodeCommand::Seek {
                    position_ms,
                    generation,
                } => {
                    if pipeline.is_current(generation) {
                        pipeline.request_reset();
                        match gapless.seek(position_ms) {
                            Ok(actual) => {
                                apply_position(&pipeline, actual);
                                emit_progress(&pipeline, &event_tx, actual);
                            }
                            Err(err) => {
                                let _ = event_tx.send(AudioEvent::ErrorOccurred(err.to_string()));
                            }
                        }
                    }
                }
                DecodeCommand::Stop { generation } => {
                    if pipeline.is_current(generation) {
                        pipeline.request_reset();
                        gapless.clear_current();
                        pipeline.samples_played.store(0, Ordering::Relaxed);
                        pipeline.position_ms.store(0, Ordering::Relaxed);
                    }
                }
                DecodeCommand::ClearPreload => {
                    gapless.clear_preload();
                }
                DecodeCommand::SetEq(config) => {
                    eq.update_config(&config);
                }
                DecodeCommand::SetCrossfade(config) => {
                    gapless.set_crossfade(config);
                }
                DecodeCommand::SetReplayGain(config) => {
                    rg_config = config;
                    rg.update(&rg_config, gapless.current_replay_gain().as_ref());
                }
                DecodeCommand::SetOutputSpec {
                    sample_rate,
                    channels,
                } => {
                    pipeline.sample_rate.store(sample_rate, Ordering::Relaxed);
                    pipeline.channels.store(channels as u32, Ordering::Relaxed);
                    gapless.set_output_spec(sample_rate, channels);
                    eq.set_sample_rate(sample_rate);
                }
            }
        }

        if pipeline.is_playing.load(Ordering::Relaxed) && gapless.has_current() {
            fill_ring(
                &pipeline,
                &mut gapless,
                &mut eq,
                &mut rg,
                &rg_config,
                &mut scratch,
                &event_tx,
            );
        }
    }
}

fn handle_open(
    pipeline: &AudioPipeline,
    gapless: &mut GaplessController,
    eq: &mut EqualizerProcessor,
    rg: &mut ReplayGainProcessor,
    rg_config: &ReplayGainConfig,
    event_tx: &broadcast::Sender<AudioEvent>,
    track: AudioTrack,
    generation: u64,
) {
    if !pipeline.is_current(generation) {
        return;
    }
    match PreloadedTrack::open(track.clone()) {
        Ok(preloaded) => {
            if !pipeline.is_current(generation) {
                return;
            }
            pipeline.request_reset();
            if !pipeline.is_current(generation) {
                return;
            }
            gapless.set_current(preloaded);
            let sample_rate = pipeline.sample_rate.load(Ordering::Relaxed);
            let channels = pipeline.channels.load(Ordering::Relaxed) as u16;
            if sample_rate > 0 && channels > 0 {
                gapless.set_output_spec(sample_rate, channels);
                eq.set_sample_rate(sample_rate);
            }
            let duration_ms = gapless.current_duration_ms();
            pipeline.duration_ms.store(duration_ms, Ordering::Relaxed);
            apply_position(pipeline, 0);
            rg.update(rg_config, gapless.current_replay_gain().as_ref());
            let _ = event_tx.send(AudioEvent::TrackChanged(Some(track)));
            let _ = event_tx.send(AudioEvent::QualityUpdated(gapless.current_quality_badge()));
        }
        Err(err) => {
            if pipeline.is_current(generation) {
                pipeline.is_playing.store(false, Ordering::SeqCst);
                let _ = event_tx.send(AudioEvent::ErrorOccurred(err.to_string()));
                let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Stopped));
            }
        }
    }
}

fn fill_ring(
    pipeline: &AudioPipeline,
    gapless: &mut GaplessController,
    eq: &mut EqualizerProcessor,
    rg: &mut ReplayGainProcessor,
    rg_config: &ReplayGainConfig,
    scratch: &mut [f32],
    event_tx: &broadcast::Sender<AudioEvent>,
) {
    let vacant = {
        let guard = recover_mutex(&pipeline.producer);
        match guard.as_ref() {
            Some(prod) => prod.vacant_len(),
            None => 0,
        }
    };
    if vacant < 256 {
        thread::sleep(Duration::from_millis(2));
        return;
    }

    let n = vacant.min(scratch.len());
    match gapless.read_samples(&mut scratch[..n]) {
        Ok((written, transitioned, is_eof)) => {
            if let Some(next_track) = transitioned {
                apply_position(pipeline, 0);
                pipeline
                    .duration_ms
                    .store(gapless.current_duration_ms(), Ordering::Relaxed);
                rg.update(rg_config, gapless.current_replay_gain().as_ref());
                // TrackTransitioned (not TrackChanged) so the player can advance
                // its queue index and preload the following track.
                let _ = event_tx.send(AudioEvent::TrackTransitioned(next_track));
                let _ = event_tx.send(AudioEvent::QualityUpdated(gapless.current_quality_badge()));
            }

            if written > 0 {
                let buf = &mut scratch[..written];
                rg.process_interleaved(buf);
                eq.process_interleaved(buf);
                let mut guard = recover_mutex(&pipeline.producer);
                if let Some(prod) = guard.as_mut() {
                    let _ = prod.push_slice(buf);
                }
            }

            if is_eof && written == 0 {
                pipeline.is_playing.store(false, Ordering::Relaxed);
                let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Ended));
            }
        }
        Err(err) => {
            let _ = event_tx.send(AudioEvent::ErrorOccurred(err.to_string()));
            thread::sleep(Duration::from_millis(4));
        }
    }
}

fn apply_position(pipeline: &AudioPipeline, position_ms: u64) {
    let sample_rate = pipeline.sample_rate.load(Ordering::Relaxed) as u64;
    let channels = pipeline.channels.load(Ordering::Relaxed) as u64;
    let samples = if sample_rate > 0 && channels > 0 {
        (position_ms.saturating_mul(sample_rate) / 1000).saturating_mul(channels)
    } else {
        0
    };
    pipeline.samples_played.store(samples, Ordering::Relaxed);
    pipeline.position_ms.store(position_ms, Ordering::Relaxed);
}

fn emit_progress(
    pipeline: &AudioPipeline,
    event_tx: &broadcast::Sender<AudioEvent>,
    position_ms: u64,
) {
    let duration_ms = pipeline.duration_ms.load(Ordering::Relaxed);
    let percentage = if duration_ms > 0 {
        (position_ms as f32 / duration_ms as f32).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let _ = event_tx.send(AudioEvent::ProgressUpdated(PlaybackProgress {
        position_ms,
        duration_ms,
        buffered_ms: position_ms,
        percentage,
    }));
}

pub fn device_buffer_frames(sample_rate: u32) -> u32 {
    let frames = (sample_rate as u64 * DEVICE_BUFFER_MS as u64) / 1000;
    frames.clamp(2048, 8192) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn realtime_fill_silence_when_paused() {
        let (pipeline, mut cons, _tx, _rx) = AudioPipeline::create();
        let mut out = [1.0f32; 8];
        realtime_fill(&mut out, &mut cons, &pipeline);
        assert!(out.iter().all(|s| *s == 0.0));
    }

    #[test]
    fn realtime_fill_drains_on_reset() {
        let (pipeline, mut cons, _tx, _rx) = AudioPipeline::create();
        {
            let mut prod = recover_mutex(&pipeline.producer);
            if let Some(prod) = prod.as_mut() {
                let _ = prod.push_slice(&[0.5, 0.5, 0.5, 0.5]);
            }
        }
        pipeline.is_playing.store(true, Ordering::Relaxed);
        pipeline.pending_reset.store(true, Ordering::Relaxed);
        let mut out = [1.0f32; 4];
        realtime_fill(&mut out, &mut cons, &pipeline);
        assert!(out.iter().all(|s| *s == 0.0));
        assert!(!pipeline.pending_reset.load(Ordering::Relaxed));
        assert_eq!(
            recover_mutex(&pipeline.producer)
                .as_ref()
                .map(|p| p.occupied_len()),
            Some(0)
        );
    }

    #[test]
    fn generation_invalidates_stale_requests() {
        let (pipeline, _cons, _tx, _rx) = AudioPipeline::create();
        let first = pipeline.next_generation();
        let second = pipeline.next_generation();
        assert!(pipeline.is_current(second));
        assert!(!pipeline.is_current(first));
    }
}
