//! Lock-free PCM pipeline: decode thread → ring buffer → CPAL callback.
//!
//! The realtime callback must never lock a Mutex, allocate, do I/O, log, or panic.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, TryRecvError};
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use tokio::sync::broadcast;

use crate::audio::dsp::{soft_limit, EqualizerProcessor, ReplayGainProcessor};
use crate::audio::dto::{
    AudioBackend, AudioEvent, AudioTrack, CrossfadeConfig, DsdOutputMode, EngineStatus, EqConfig,
    PlaybackMode, PlaybackProgress, PlaybackState, ReplayGainConfig, VolumeControlKind,
};
use crate::audio::gapless::{GaplessController, PreloadedTrack};
#[cfg(windows)]
use crate::audio::pcm::{format_sample_rate_khz, frame_aligned_len, AudioFormat, PcmSampleFormat};
#[cfg(windows)]
use crate::audio::pcm_convert::f32_to_pcm_bytes;
#[cfg(windows)]
use crate::audio::pcm_ring::PcmRingProducer;
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
const INITIAL_SAMPLE_RATE: u32 = 44_100;
const INITIAL_CHANNELS: u16 = 2;
const MIN_RING_SAMPLES: usize = 1_024;
const DECODE_COMMAND_CAPACITY: usize = 128;

const DECODE_CHUNK: usize = 4096;
const RESET_WAIT: Duration = Duration::from_millis(80);
#[cfg(windows)]
const RING_DRAIN_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Debug)]
pub enum DecodeCommand {
    OpenTrack {
        track: AudioTrack,
        generation: u64,
        start_position_ms: u64,
    },
    PreloadNext {
        track: AudioTrack,
        generation: u64,
    },
    ClearPreload,
    Stop {
        generation: u64,
    },
    SetEq(EqConfig),
    SetCrossfade(CrossfadeConfig),
    SetReplayGain(ReplayGainConfig),
    SetOutputSpec {
        sample_rate: u32,
        channels: u16,
    },
    SetExclusiveMode(bool),
    SetBitPerfect(bool),
    Shutdown,
}

pub struct AudioPipeline {
    pub producer: Mutex<Option<HeapProd<f32>>>,
    #[cfg(windows)]
    pub pcm_producer: Mutex<Option<PcmRingProducer>>,
    #[cfg(windows)]
    pub output_pcm_format: Mutex<Option<(AudioFormat, bool)>>,
    #[cfg(windows)]
    pub output_device: Mutex<Option<crate::audio::dto::AudioDeviceDTO>>,
    #[cfg(windows)]
    pub wire_logged: AtomicBool,
    #[cfg(windows)]
    pub render_buffer_frames: AtomicU32,
    #[cfg(windows)]
    pub render_period_100ns: AtomicU64,
    #[cfg(windows)]
    pub render_wave_describe: Mutex<Option<String>>,
    pub pending_reset: Arc<AtomicBool>,
    pub exclusive_mode: AtomicBool,
    pub bit_perfect: AtomicBool,
    pub mqa_passthrough: AtomicBool,
    /// [`DsdOutputMode::to_index`]: 0 = Native DSD, 1 = DoP, 2 = DSD → PCM.
    /// Only consulted directly in Advanced mode; Auto/HQ resolve per track.
    pub dsd_output_mode: AtomicU32,
    /// [`PlaybackMode::to_index`]: 0 = Auto, 1 = HighQuality, 2 = Multitask, 3 = Advanced.
    pub playback_mode: AtomicU32,
    /// [`AudioBackend::to_index`]; the backend explicitly chosen in Advanced mode.
    pub advanced_backend: AtomicU32,
    /// True only while a native ASIO stream owns the output device.
    #[cfg(windows)]
    pub native_dsd_active: AtomicBool,
    /// Shared with the ASIO callback so pause/resume never touches the
    /// real-time callback's synchronization primitives.
    #[cfg(windows)]
    pub native_dsd_playing: Arc<AtomicBool>,
    #[cfg(windows)]
    pub asio_driver_id: Mutex<Option<String>>,
    pub sample_rate: AtomicU32,
    pub channels: AtomicU32,
    pub position_ms: AtomicU64,
    pub duration_ms: AtomicU64,
    pub samples_played: AtomicU64,
    pub generation: AtomicU64,
    pub is_playing: AtomicBool,
    pub volume_bits: AtomicU32,
    pub is_muted: AtomicBool,
    /// Last user software volume; never forced to 1.0 on bit-perfect/DoP/Native.
    pub user_volume_bits: AtomicU32,
    pub user_muted: AtomicBool,
    pub underrun_count: AtomicU64,
    pub underrun_samples: AtomicU64,
    pub output_samples_total: AtomicU64,
    pub transition_target_total: AtomicU64,
    pub transition_ready: AtomicBool,
    pending_transition: Mutex<Option<ScheduledTransition>>,
    pending_seek: Mutex<Option<(u64, u64)>>,
}

#[derive(Debug, Clone)]
pub struct ScheduledTransition {
    pub track: AudioTrack,
    pub duration_ms: u64,
    pub quality_badge: Option<crate::audio::dto::QualityBadge>,
    #[cfg(windows)]
    pub engine_status: Option<EngineStatus>,
}

impl AudioPipeline {
    pub fn create() -> (
        Arc<Self>,
        HeapCons<f32>,
        Sender<DecodeCommand>,
        Receiver<DecodeCommand>,
    ) {
        let rb = HeapRb::<f32>::new(ring_capacity_samples(INITIAL_SAMPLE_RATE, INITIAL_CHANNELS));
        let (prod, cons) = rb.split();
        let (tx, rx) = crossbeam_channel::bounded(DECODE_COMMAND_CAPACITY);
        let pipeline = Arc::new(Self {
            producer: Mutex::new(Some(prod)),
            #[cfg(windows)]
            pcm_producer: Mutex::new(None),
            #[cfg(windows)]
            output_pcm_format: Mutex::new(None),
            #[cfg(windows)]
            output_device: Mutex::new(None),
            #[cfg(windows)]
            wire_logged: AtomicBool::new(false),
            #[cfg(windows)]
            render_buffer_frames: AtomicU32::new(0),
            #[cfg(windows)]
            render_period_100ns: AtomicU64::new(0),
            #[cfg(windows)]
            render_wave_describe: Mutex::new(None),
            pending_reset: Arc::new(AtomicBool::new(false)),
            exclusive_mode: AtomicBool::new(false),
            bit_perfect: AtomicBool::new(false),
            mqa_passthrough: AtomicBool::new(false),
            dsd_output_mode: AtomicU32::new(DsdOutputMode::Pcm.to_index()),
            playback_mode: AtomicU32::new(PlaybackMode::Auto.to_index()),
            advanced_backend: AtomicU32::new(AudioBackend::Shared.to_index()),
            #[cfg(windows)]
            native_dsd_active: AtomicBool::new(false),
            #[cfg(windows)]
            native_dsd_playing: Arc::new(AtomicBool::new(false)),
            #[cfg(windows)]
            asio_driver_id: Mutex::new(None),
            sample_rate: AtomicU32::new(44100),
            channels: AtomicU32::new(2),
            position_ms: AtomicU64::new(0),
            duration_ms: AtomicU64::new(0),
            samples_played: AtomicU64::new(0),
            generation: AtomicU64::new(0),
            is_playing: AtomicBool::new(false),
            volume_bits: AtomicU32::new(1.0f32.to_bits()),
            is_muted: AtomicBool::new(false),
            user_volume_bits: AtomicU32::new(1.0f32.to_bits()),
            user_muted: AtomicBool::new(false),
            underrun_count: AtomicU64::new(0),
            underrun_samples: AtomicU64::new(0),
            output_samples_total: AtomicU64::new(0),
            transition_target_total: AtomicU64::new(0),
            transition_ready: AtomicBool::new(false),
            pending_transition: Mutex::new(None),
            pending_seek: Mutex::new(None),
        });
        (pipeline, cons, tx, rx)
    }

    pub fn recreate_ring(&self, sample_rate: u32, channels: u16) -> HeapCons<f32> {
        let rb = HeapRb::<f32>::new(ring_capacity_samples(sample_rate, channels));
        let (prod, cons) = rb.split();
        *recover_mutex(&self.producer) = Some(prod);
        cons
    }

    pub fn pending_reset_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.pending_reset)
    }

    #[cfg(windows)]
    pub fn set_pcm_producer(&self, producer: PcmRingProducer) {
        *recover_mutex(&self.pcm_producer) = Some(producer);
    }

    #[cfg(windows)]
    pub fn clear_pcm_producer(&self) {
        *recover_mutex(&self.pcm_producer) = None;
    }

    #[cfg(windows)]
    pub fn set_render_wire(&self, wave: String, buffer_frames: u32, period_100ns: i64) {
        *recover_mutex(&self.render_wave_describe) = Some(wave);
        self.render_buffer_frames
            .store(buffer_frames, Ordering::Relaxed);
        self.render_period_100ns
            .store(period_100ns.max(0) as u64, Ordering::Relaxed);
    }

    #[cfg(windows)]
    pub fn set_output_pcm_format(&self, format: AudioFormat, packed_s24: bool) {
        *recover_mutex(&self.output_pcm_format) = Some((format, packed_s24));
    }

    #[cfg(windows)]
    pub fn set_output_device(&self, device: crate::audio::dto::AudioDeviceDTO) {
        *recover_mutex(&self.output_device) = Some(device);
    }

    #[cfg(windows)]
    pub fn output_pcm_format(&self) -> Option<(AudioFormat, bool)> {
        *recover_mutex(&self.output_pcm_format)
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

    pub fn store_user_volume(&self, volume: f32, muted: bool, apply_to_dsp: bool) {
        let bits = volume.to_bits();
        self.user_volume_bits.store(bits, Ordering::SeqCst);
        self.user_muted.store(muted, Ordering::SeqCst);
        if apply_to_dsp {
            self.volume_bits.store(bits, Ordering::SeqCst);
            self.is_muted.store(muted, Ordering::SeqCst);
        }
    }

    pub fn enter_unity_gain_volume(&self) {
        self.volume_bits.store(1.0f32.to_bits(), Ordering::SeqCst);
        self.is_muted.store(false, Ordering::SeqCst);
    }

    pub fn restore_software_volume(&self) {
        self.volume_bits.store(
            self.user_volume_bits.load(Ordering::Relaxed),
            Ordering::SeqCst,
        );
        self.is_muted
            .store(self.user_muted.load(Ordering::Relaxed), Ordering::SeqCst);
    }

    pub fn applied_volume(&self) -> f32 {
        f32::from_bits(self.volume_bits.load(Ordering::Relaxed))
    }

    pub fn request_seek(&self, position_ms: u64, generation: u64) {
        *recover_mutex(&self.pending_seek) = Some((position_ms, generation));
    }

    fn take_pending_seek(&self) -> Option<(u64, u64)> {
        recover_mutex(&self.pending_seek).take()
    }

    fn schedule_transition(&self, transition: ScheduledTransition, samples_ahead: u64) {
        *recover_mutex(&self.pending_transition) = Some(transition);
        self.transition_ready.store(false, Ordering::Release);
        let target = self
            .output_samples_total
            .load(Ordering::Acquire)
            .saturating_add(samples_ahead)
            .max(1);
        self.transition_target_total
            .store(target, Ordering::Release);
    }

    pub fn take_audible_transition(&self) -> Option<ScheduledTransition> {
        if !self.transition_ready.swap(false, Ordering::AcqRel) {
            return None;
        }
        let transition = recover_mutex(&self.pending_transition).take();
        if let Some(ref scheduled) = transition {
            let total = self.output_samples_total.load(Ordering::Acquire);
            let target = self.transition_target_total.swap(0, Ordering::AcqRel);
            let overshoot = total.saturating_sub(target);
            self.samples_played.store(overshoot, Ordering::Relaxed);
            self.duration_ms
                .store(scheduled.duration_ms, Ordering::Relaxed);
        }
        transition
    }

    pub fn underrun_stats(&self) -> (u64, u64) {
        (
            self.underrun_count.load(Ordering::Relaxed),
            self.underrun_samples.load(Ordering::Relaxed),
        )
    }
}

pub fn ring_capacity_samples(sample_rate: u32, channels: u16) -> usize {
    let samples = (sample_rate.max(1) as u64)
        .saturating_mul(channels.max(1) as u64)
        .saturating_mul(RING_BUFFER_MS as u64)
        / 1_000;
    (samples as usize).max(MIN_RING_SAMPLES)
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
        let missing = output.len() - written;
        pipeline.underrun_count.fetch_add(1, Ordering::Relaxed);
        pipeline
            .underrun_samples
            .fetch_add(missing as u64, Ordering::Relaxed);
        output[written..].fill(0.0);
    }

    if written > 0 {
        let total = pipeline
            .output_samples_total
            .fetch_add(written as u64, Ordering::Relaxed)
            + written as u64;
        let target = pipeline.transition_target_total.load(Ordering::Acquire);
        if target > 0 && total >= target {
            pipeline.transition_ready.store(true, Ordering::Release);
        }
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

/// One attempt in the per-track playback plan, ordered best → safest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanStep {
    /// ASIO native DSD (1-bit straight to the driver).
    NativeDsd,
    /// WASAPI Exclusive carrying DSD inside 24-bit PCM (DoP 1.1).
    Dop,
    /// WASAPI Exclusive with the exact source PCM format (bit-perfect wire).
    ExclusiveBitPerfect,
    /// WASAPI Exclusive with a negotiated (possibly converted) PCM format.
    ExclusivePcm,
    /// WASAPI Shared (CPAL); DSD is always converted to PCM here.
    Shared,
}

impl PlanStep {
    pub const fn label(self) -> &'static str {
        match self {
            Self::NativeDsd => "ASIO Native DSD",
            Self::Dop => "WASAPI Exclusive DoP",
            Self::ExclusiveBitPerfect => "WASAPI Exclusive bit-perfect",
            Self::ExclusivePcm => "WASAPI Exclusive PCM",
            Self::Shared => "WASAPI Shared",
        }
    }
}

/// Pure decision tree: user mode + source kind (+ Advanced selections) →
/// ordered fallback plan. Every mode that may fall back ends in [`PlanStep::Shared`]
/// so playback never stops just because a better path is unavailable.
/// Advanced returns exactly the user's choice (single step) and fails loudly,
/// with one exception: ASIO has no PCM path, so PCM files route to Shared.
pub fn resolve_plan(
    mode: PlaybackMode,
    is_dsd: bool,
    advanced_backend: AudioBackend,
    advanced_transport: DsdOutputMode,
) -> Vec<PlanStep> {
    resolve_plan_for_source(
        mode,
        is_dsd,
        advanced_backend,
        advanced_transport,
        None,
        false,
        false,
    )
}

/// Same as [`resolve_plan`], with source details used while selecting a route.
pub fn resolve_plan_for_source(
    mode: PlaybackMode,
    is_dsd: bool,
    advanced_backend: AudioBackend,
    advanced_transport: DsdOutputMode,
    dsd_rate: Option<crate::audio::dto::DsdRate>,
    is_mqa_payload_verified: bool,
    mqa_passthrough: bool,
) -> Vec<PlanStep> {
    use nnpm_audio_core::router::{
        AudioBackend as CoreBackend, DacCaps, DsdOutputMode as CoreDsd, OutputRoute, OutputRouter,
        PlaybackMode as CoreMode, RouterInput,
    };
    use nnpm_audio_core::types::DsdRate as CoreRate;

    let core_rate = dsd_rate.map(|rate| match rate {
        crate::audio::dto::DsdRate::Dsd64 => CoreRate::Dsd64,
        crate::audio::dto::DsdRate::Dsd128 => CoreRate::Dsd128,
        crate::audio::dto::DsdRate::Dsd256 => CoreRate::Dsd256,
        crate::audio::dto::DsdRate::Dsd512 => CoreRate::Dsd512,
        crate::audio::dto::DsdRate::Dsd1024 => CoreRate::Dsd1024,
    });
    let input = RouterInput {
        mode: match mode {
            PlaybackMode::Auto => CoreMode::Auto,
            PlaybackMode::HighQuality => CoreMode::HighQuality,
            PlaybackMode::Multitask => CoreMode::Multitask,
            PlaybackMode::Advanced => CoreMode::Advanced,
        },
        is_dsd,
        is_mqa: is_mqa_payload_verified,
        dsd_rate: core_rate,
        backend: match advanced_backend {
            AudioBackend::Shared => CoreBackend::Shared,
            AudioBackend::WasapiExclusive => CoreBackend::WasapiExclusive,
            AudioBackend::Asio => CoreBackend::Asio,
        },
        dsd_mode: match advanced_transport {
            DsdOutputMode::NativeDsd => CoreDsd::NativeDsd,
            DsdOutputMode::Dop => CoreDsd::Dop,
            DsdOutputMode::Pcm => CoreDsd::Pcm,
        },
        // Auto/HQ always attempt Exclusive bit-perfect for PCM, matching the
        // historical fallback list. Exclusive occupancy still requires a free DAC.
        bit_perfect: true,
        mqa_passthrough,
        caps: DacCaps {
            exclusive: true,
            dop_rates: vec![CoreRate::Dsd64, CoreRate::Dsd128, CoreRate::Dsd256],
            native_dsd_rates: CoreRate::ALL.to_vec(),
            mqa_renderer: false,
            web: false,
        },
    };

    match mode {
        PlaybackMode::Auto | PlaybackMode::HighQuality | PlaybackMode::Multitask => {
            OutputRouter::plan(&input)
                .into_iter()
                .filter_map(|route| match route {
                    OutputRoute::NativeDsd => Some(PlanStep::NativeDsd),
                    OutputRoute::Dop => Some(PlanStep::Dop),
                    OutputRoute::ExclusiveBitPerfect => Some(PlanStep::ExclusiveBitPerfect),
                    OutputRoute::ExclusivePcm => Some(PlanStep::ExclusivePcm),
                    OutputRoute::Shared | OutputRoute::WebAudio => Some(PlanStep::Shared),
                })
                .collect()
        }
        PlaybackMode::Advanced => {
            if is_dsd {
                match (advanced_backend, advanced_transport) {
                    (AudioBackend::Asio, _) | (_, DsdOutputMode::NativeDsd) => {
                        vec![PlanStep::NativeDsd]
                    }
                    (AudioBackend::WasapiExclusive, DsdOutputMode::Dop) => {
                        // Advanced is strict: an unsupported DoP rate must fail
                        // in try_dop, never change the user's transport to PCM.
                        vec![PlanStep::Dop]
                    }
                    (AudioBackend::Shared, DsdOutputMode::Dop) => vec![PlanStep::Shared],
                    (AudioBackend::WasapiExclusive, DsdOutputMode::Pcm) => {
                        vec![PlanStep::ExclusivePcm]
                    }
                    (AudioBackend::Shared, DsdOutputMode::Pcm) => vec![PlanStep::Shared],
                }
            } else {
                match advanced_backend {
                    AudioBackend::WasapiExclusive => {
                        vec![PlanStep::ExclusiveBitPerfect, PlanStep::ExclusivePcm]
                    }
                    AudioBackend::Asio | AudioBackend::Shared => vec![PlanStep::Shared],
                }
            }
        }
    }
}

/// Gapless PCM reuse is safe only when the next track's preferred route is the
/// route that is already open. Native DSD, DoP, and bit-perfect PCM require a
/// fresh session because their wire format is track-specific.
pub fn can_reuse_route_for_gapless(
    mode: PlaybackMode,
    is_dsd: bool,
    advanced_backend: AudioBackend,
    advanced_transport: DsdOutputMode,
    current: PlanStep,
) -> bool {
    matches!(current, PlanStep::Shared | PlanStep::ExclusivePcm)
        && resolve_plan(mode, is_dsd, advanced_backend, advanced_transport)
            .first()
            .copied()
            == Some(current)
}

pub fn spawn_decode_thread(
    pipeline: Arc<AudioPipeline>,
    cmd_rx: Receiver<DecodeCommand>,
    event_tx: broadcast::Sender<AudioEvent>,
    #[cfg(windows)] control: crate::audio::control::AudioControlHandle,
) -> Option<JoinHandle<()>> {
    let spawn_result = thread::Builder::new()
        .name("audio-decode".into())
        .spawn(move || {
            crate::sync_util::set_current_thread_priority_high();
            #[cfg(windows)]
            decode_loop(pipeline, cmd_rx, event_tx, control);
            #[cfg(not(windows))]
            decode_loop(pipeline, cmd_rx, event_tx);
        });
    match spawn_result {
        Ok(handle) => Some(handle),
        Err(err) => {
            tracing::error!("Failed to spawn audio decode thread: {err}");
            None
        }
    }
}

fn decode_loop(
    pipeline: Arc<AudioPipeline>,
    cmd_rx: Receiver<DecodeCommand>,
    event_tx: broadcast::Sender<AudioEvent>,
    #[cfg(windows)] control: crate::audio::control::AudioControlHandle,
) {
    let mut gapless = GaplessController::new(44100, 2);
    let mut eq = EqualizerProcessor::new(44100, 2, &EqConfig::default());
    let mut rg = ReplayGainProcessor::new();
    let mut rg_config = ReplayGainConfig::default();
    let mut scratch = vec![0.0f32; DECODE_CHUNK];
    #[cfg(windows)]
    let mut byte_scratch = Vec::with_capacity(DECODE_CHUNK * 4);
    #[cfg(windows)]
    let mut pcm_scratch = Vec::with_capacity(DECODE_CHUNK * 4);
    #[cfg(windows)]
    let mut pcm_leftover = Vec::new();
    #[cfg(windows)]
    let mut drain_deadline: Option<Instant> = None;
    #[cfg(windows)]
    let mut native: Option<crate::audio::asio::NativeDsdSession> = None;
    #[cfg(windows)]
    let mut dop: Option<DopSession> = None;

    loop {
        #[cfg(windows)]
        if let Some(session) = native.as_ref() {
            let position = session.position_ms().min(session.format().duration_ms);
            apply_position(&pipeline, position);
            let failure = session.failure_reason();
            if session.is_finished() || failure.is_some() {
                let dsd_rate = close_native_session(&mut native, &pipeline);
                pipeline.is_playing.store(false, Ordering::Release);
                let _ = event_tx.send(AudioEvent::NativeDsdStatus {
                    active: false,
                    dsd_rate,
                    error: failure.clone(),
                });
                if let Some(error) = failure {
                    let _ = event_tx.send(AudioEvent::ErrorOccurred(error));
                    let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Stopped));
                } else {
                    let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Ended));
                }
            }
        }

        if let Some((position_ms, generation)) = pipeline.take_pending_seek() {
            if pipeline.is_current(generation) {
                seek_current_source(
                    &pipeline,
                    &mut gapless,
                    &event_tx,
                    #[cfg(windows)]
                    &mut native,
                    #[cfg(windows)]
                    &mut dop,
                    #[cfg(windows)]
                    &mut pcm_leftover,
                    #[cfg(windows)]
                    &mut drain_deadline,
                    position_ms,
                );
            }
        }

        let busy = pipeline.is_playing.load(Ordering::Relaxed)
            && (gapless.has_current() || {
                #[cfg(windows)]
                {
                    native.is_some() || dop.is_some()
                }
                #[cfg(not(windows))]
                {
                    false
                }
            });
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
                DecodeCommand::OpenTrack {
                    track,
                    generation,
                    start_position_ms,
                } => {
                    #[cfg(windows)]
                    {
                        pcm_leftover.clear();
                        drain_deadline = None;
                        dop = None;
                        pipeline.wire_logged.store(false, Ordering::Relaxed);
                        if let Some(dsd_rate) = close_native_session(&mut native, &pipeline) {
                            let _ = event_tx.send(AudioEvent::NativeDsdStatus {
                                active: false,
                                dsd_rate: Some(dsd_rate),
                                error: None,
                            });
                        }
                    }
                    handle_open(
                        &pipeline,
                        &mut gapless,
                        &mut eq,
                        &mut rg,
                        &rg_config,
                        &event_tx,
                        track,
                        generation,
                        #[cfg(windows)]
                        &control,
                        #[cfg(windows)]
                        &mut native,
                        #[cfg(windows)]
                        &mut dop,
                    );
                    // A reopen (device/engine change) must seek only after the
                    // new decoder has been installed. Sending a separate seek
                    // command races with OpenTrack and can seek the old decoder,
                    // leaving the newly opened track at 0:00.
                    if start_position_ms > 0 && pipeline.is_current(generation) {
                        seek_current_source(
                            &pipeline,
                            &mut gapless,
                            &event_tx,
                            #[cfg(windows)]
                            &mut native,
                            #[cfg(windows)]
                            &mut dop,
                            #[cfg(windows)]
                            &mut pcm_leftover,
                            #[cfg(windows)]
                            &mut drain_deadline,
                            start_position_ms,
                        );
                    }
                }
                DecodeCommand::PreloadNext { track, generation } => {
                    if pipeline.is_current(generation)
                        && !pipeline.bit_perfect.load(Ordering::Relaxed)
                    {
                        match PreloadedTrack::open(track) {
                            Ok(preloaded) => {
                                if pipeline.is_current(generation) {
                                    if let Err(err) = gapless.set_preloaded_next(preloaded) {
                                        tracing::warn!(
                                            error = %err,
                                            "Unable to preload next DSD track for PCM output"
                                        );
                                    }
                                }
                            }
                            Err(err) => tracing::warn!("Unable to preload next track: {err}"),
                        }
                    }
                }
                DecodeCommand::Stop { generation } => {
                    if pipeline.is_current(generation) {
                        #[cfg(windows)]
                        {
                            dop = None;
                            if let Some(dsd_rate) = close_native_session(&mut native, &pipeline) {
                                let _ = event_tx.send(AudioEvent::NativeDsdStatus {
                                    active: false,
                                    dsd_rate: Some(dsd_rate),
                                    error: None,
                                });
                            }
                        }
                        pipeline.request_reset();
                        gapless.clear_current();
                        pipeline.samples_played.store(0, Ordering::Relaxed);
                        pipeline.position_ms.store(0, Ordering::Relaxed);
                        #[cfg(windows)]
                        {
                            pcm_leftover.clear();
                            drain_deadline = None;
                        }
                        emit_engine_status_cleared(&pipeline, &event_tx);
                    }
                }
                DecodeCommand::ClearPreload => {
                    gapless.clear_preload();
                }
                DecodeCommand::SetEq(config) => {
                    eq.update_config(&config);
                }
                DecodeCommand::SetCrossfade(config) => {
                    if !pipeline.bit_perfect.load(Ordering::Relaxed) {
                        gapless.set_crossfade(config);
                    }
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
                    eq.set_output_spec(sample_rate, channels);
                }
                DecodeCommand::SetBitPerfect(enabled) => {
                    pipeline.bit_perfect.store(enabled, Ordering::SeqCst);
                    if enabled {
                        pipeline.enter_unity_gain_volume();
                        gapless.set_crossfade(CrossfadeConfig {
                            enabled: false,
                            ..CrossfadeConfig::default()
                        });
                        gapless.clear_preload();
                    } else {
                        pipeline.restore_software_volume();
                    }
                    #[cfg(windows)]
                    {
                        pcm_leftover.clear();
                        drain_deadline = None;
                    }
                    emit_engine_status_cleared(&pipeline, &event_tx);
                }
                DecodeCommand::SetExclusiveMode(enabled) => {
                    pipeline.exclusive_mode.store(enabled, Ordering::SeqCst);
                    if !enabled {
                        pipeline.bit_perfect.store(false, Ordering::SeqCst);
                        pipeline.restore_software_volume();
                    }
                    #[cfg(windows)]
                    {
                        pcm_leftover.clear();
                        drain_deadline = None;
                    }
                    emit_engine_status_cleared(&pipeline, &event_tx);
                }
            }
        }

        if pipeline.is_playing.load(Ordering::Relaxed) {
            #[cfg(windows)]
            {
                if native.is_some() {
                    // The ASIO callback pulls directly from its own ring.
                } else if dop.is_some() {
                    fill_ring_dop(
                        &pipeline,
                        &mut dop,
                        &mut pcm_leftover,
                        &mut drain_deadline,
                        &event_tx,
                    );
                } else if gapless.has_current() {
                    if !pipeline.exclusive_mode.load(Ordering::Relaxed) {
                        fill_ring(
                            &pipeline,
                            &mut gapless,
                            &mut eq,
                            &mut rg,
                            &rg_config,
                            &mut scratch,
                            &event_tx,
                        );
                    } else if pipeline.bit_perfect.load(Ordering::Relaxed) {
                        fill_ring_bit_perfect(
                            &pipeline,
                            &mut gapless,
                            &mut byte_scratch,
                            &mut pcm_leftover,
                            &mut drain_deadline,
                            &event_tx,
                        );
                    } else {
                        fill_ring_wasapi(
                            &pipeline,
                            &mut gapless,
                            &mut eq,
                            &mut rg,
                            &rg_config,
                            &mut scratch,
                            &mut pcm_scratch,
                            &mut pcm_leftover,
                            &mut drain_deadline,
                            &event_tx,
                        );
                    }
                }
            }
            #[cfg(not(windows))]
            {
                if gapless.has_current() {
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
    }
}

/// Exclusive-mode DoP session owned by the decode thread.
#[cfg(windows)]
struct DopSession {
    reader: crate::audio::dop::DopReader,
    input_done: bool,
}

/// Seek whichever source currently owns playback (native ASIO, DoP, or the
/// gapless decoder). Clears wire leftovers so no stale bytes survive the seek.
#[allow(clippy::too_many_arguments)]
fn seek_current_source(
    pipeline: &AudioPipeline,
    gapless: &mut GaplessController,
    event_tx: &broadcast::Sender<AudioEvent>,
    #[cfg(windows)] native: &mut Option<crate::audio::asio::NativeDsdSession>,
    #[cfg(windows)] dop: &mut Option<DopSession>,
    #[cfg(windows)] pcm_leftover: &mut Vec<u8>,
    #[cfg(windows)] drain_deadline: &mut Option<Instant>,
    position_ms: u64,
) {
    pipeline.request_reset();
    #[cfg(windows)]
    {
        pcm_leftover.clear();
        *drain_deadline = None;

        if native.is_some() {
            let result = native
                .as_mut()
                .map(|session| session.seek(position_ms))
                .expect("native checked above");
            match result {
                Ok(actual) => {
                    apply_position(pipeline, actual);
                    emit_progress(pipeline, event_tx, actual);
                }
                Err(err) => {
                    let dsd_rate = close_native_session(native, pipeline);
                    let message = err.to_string();
                    let _ = event_tx.send(AudioEvent::NativeDsdStatus {
                        active: false,
                        dsd_rate,
                        error: Some(message.clone()),
                    });
                    pipeline.is_playing.store(false, Ordering::Release);
                    let _ = event_tx.send(AudioEvent::ErrorOccurred(message));
                    let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Stopped));
                }
            }
            return;
        }

        if let Some(session) = dop.as_mut() {
            session.input_done = false;
            match session.reader.seek_ms(position_ms) {
                Ok(actual) => {
                    apply_position(pipeline, actual);
                    emit_progress(pipeline, event_tx, actual);
                }
                Err(err) => {
                    dop.take();
                    pipeline.is_playing.store(false, Ordering::Release);
                    let _ = event_tx.send(AudioEvent::ErrorOccurred(err.to_string()));
                    let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Stopped));
                }
            }
            return;
        }
    }

    match gapless.seek(position_ms) {
        Ok(actual) => {
            apply_position(pipeline, actual);
            emit_progress(pipeline, event_tx, actual);
        }
        Err(err) => {
            let _ = event_tx.send(AudioEvent::ErrorOccurred(err.to_string()));
        }
    }
}

#[cfg(windows)]
fn close_native_session(
    native: &mut Option<crate::audio::asio::NativeDsdSession>,
    pipeline: &AudioPipeline,
) -> Option<crate::audio::dto::DsdRate> {
    let dsd_rate = native.as_ref().map(|session| session.format().dsd_rate);
    native.take();
    pipeline.native_dsd_active.store(false, Ordering::Release);
    pipeline.native_dsd_playing.store(false, Ordering::Release);
    dsd_rate
}

fn is_dsd_path(path: &str) -> bool {
    path.rsplit_once('.')
        .map(|(_, extension)| {
            extension.eq_ignore_ascii_case("dsf") || extension.eq_ignore_ascii_case("dff")
        })
        .unwrap_or(false)
}

fn peek_dsd_rate(path: &str) -> Option<crate::audio::dto::DsdRate> {
    let mut source = nnpm_audio_core::source::MediaSource::open_file(path).ok()?;
    let mut head = vec![0u8; 256 * 1024];
    use std::io::Read;
    let n = source.read(&mut head).ok()?;
    let format = nnpm_audio_core::dsd::parse_header(&head[..n], source.len()).ok()?;
    Some(match format.dsd_rate {
        nnpm_audio_core::types::DsdRate::Dsd64 => crate::audio::dto::DsdRate::Dsd64,
        nnpm_audio_core::types::DsdRate::Dsd128 => crate::audio::dto::DsdRate::Dsd128,
        nnpm_audio_core::types::DsdRate::Dsd256 => crate::audio::dto::DsdRate::Dsd256,
        nnpm_audio_core::types::DsdRate::Dsd512 => crate::audio::dto::DsdRate::Dsd512,
        nnpm_audio_core::types::DsdRate::Dsd1024 => crate::audio::dto::DsdRate::Dsd1024,
    })
}

fn peek_mqa_payload_verified(path: &str) -> bool {
    let Ok(mut source) = nnpm_audio_core::source::MediaSource::open_file(path) else {
        return false;
    };
    nnpm_audio_core::mqa::MqaDetector::detect(&mut source, &[])
        .map(|info| info.payload_verified())
        .unwrap_or(false)
}

#[allow(clippy::too_many_arguments)]
fn handle_open(
    pipeline: &AudioPipeline,
    gapless: &mut GaplessController,
    eq: &mut EqualizerProcessor,
    rg: &mut ReplayGainProcessor,
    rg_config: &ReplayGainConfig,
    event_tx: &broadcast::Sender<AudioEvent>,
    track: AudioTrack,
    generation: u64,
    #[cfg(windows)] control: &crate::audio::control::AudioControlHandle,
    #[cfg(windows)] native: &mut Option<crate::audio::asio::NativeDsdSession>,
    #[cfg(windows)] dop: &mut Option<DopSession>,
) {
    if !pipeline.is_current(generation) {
        return;
    }

    #[cfg(windows)]
    {
        let is_dsd = !track.is_http_stream() && is_dsd_path(&track.path);
        let dsd_rate = if is_dsd {
            peek_dsd_rate(&track.path)
        } else {
            None
        };
        let mode = PlaybackMode::from_index(pipeline.playback_mode.load(Ordering::Acquire));
        let advanced_backend =
            AudioBackend::from_index(pipeline.advanced_backend.load(Ordering::Acquire));
        let transport = DsdOutputMode::from_index(pipeline.dsd_output_mode.load(Ordering::Acquire));
        let mqa_passthrough = pipeline.mqa_passthrough.load(Ordering::Acquire);
        let is_mqa_payload_verified =
            mqa_passthrough && !track.is_http_stream() && peek_mqa_payload_verified(&track.path);
        let plan = resolve_plan_for_source(
            mode,
            is_dsd,
            advanced_backend,
            transport,
            dsd_rate,
            is_mqa_payload_verified,
            mqa_passthrough,
        );
        let mut reasons: Vec<String> = Vec::new();
        if let Some(reason) = asio_pcm_shared_reason(mode, is_dsd, advanced_backend) {
            reasons.push(reason.into());
        }

        for step in plan {
            if !pipeline.is_current(generation) {
                return;
            }
            let outcome = match step {
                PlanStep::NativeDsd => try_native_dsd(
                    pipeline, event_tx, &track, generation, control, native, mode, &reasons,
                ),
                PlanStep::Dop => try_dop(
                    pipeline, gapless, event_tx, &track, generation, control, dop, &reasons,
                ),
                PlanStep::ExclusiveBitPerfect | PlanStep::ExclusivePcm => try_exclusive(
                    pipeline,
                    gapless,
                    eq,
                    rg,
                    rg_config,
                    event_tx,
                    &track,
                    generation,
                    control,
                    step == PlanStep::ExclusiveBitPerfect,
                    &reasons,
                ),
                PlanStep::Shared => try_shared(
                    pipeline, gapless, eq, rg, rg_config, event_tx, &track, generation, control,
                    is_dsd, &reasons,
                ),
            };
            match outcome {
                Ok(true) => return,
                Ok(false) => return, // stale generation; a newer OpenTrack owns the engine
                Err(err) => {
                    let reason = format!("{}: {}", step.label(), err);
                    tracing::warn!(target: "audio", %reason, "playback path failed; trying next");
                    reasons.push(reason);
                }
            }
        }

        // Every planned path failed. Stop with an explicit, complete reason.
        if pipeline.is_current(generation) {
            pipeline.is_playing.store(false, Ordering::SeqCst);
            if pipeline.exclusive_mode.swap(false, Ordering::SeqCst) {
                pipeline.bit_perfect.store(false, Ordering::SeqCst);
                pipeline.restore_software_volume();
                if let Err(err) = control.set_exclusive_mode(false, AudioFormat::s16(48_000, 2)) {
                    tracing::warn!(
                        target: "wasapi",
                        error = %err,
                        "failed to restore Shared after playback plan exhausted"
                    );
                }
            }
            // `reasons` is ordered from the preferred route to the terminal
            // fallback.  Earlier failures (for example a normal bit-perfect
            // rejection) are diagnostic context, not the reason playback
            // ultimately stopped.  Sending the whole chain made the UI match
            // the first "Format not supported by DAC" fragment even when the
            // real failure came later from the Shared decoder.
            let message = terminal_playback_error(&reasons);
            let _ = event_tx.send(AudioEvent::ErrorOccurred(message));
            let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Stopped));
        }
    }

    #[cfg(not(windows))]
    {
        match PreloadedTrack::open(track.clone()) {
            Ok(preloaded) => {
                if !pipeline.is_current(generation) {
                    return;
                }
                let quality = preloaded.quality_badge().clone();
                let source = preloaded.source_format();
                pipeline.request_reset();
                gapless.set_current(preloaded);
                let sample_rate = pipeline.sample_rate.load(Ordering::Relaxed);
                let channels = pipeline.channels.load(Ordering::Relaxed) as u16;
                if sample_rate > 0 && channels > 0 {
                    if quality.source_type.as_deref() == Some("DSD") {
                        if let Err(err) = gapless.set_decoder_output_format(Some(
                            crate::audio::pcm::AudioFormat::f32(sample_rate, source.channels),
                        )) {
                            pipeline.is_playing.store(false, Ordering::SeqCst);
                            let _ = event_tx.send(AudioEvent::ErrorOccurred(err.to_string()));
                            let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Stopped));
                            return;
                        }
                    }
                    gapless.set_output_spec(sample_rate, channels);
                    eq.set_output_spec(sample_rate, channels);
                }
                let duration_ms = gapless.current_duration_ms();
                pipeline.duration_ms.store(duration_ms, Ordering::Relaxed);
                apply_position(pipeline, 0);
                rg.update(rg_config, gapless.current_replay_gain().as_ref());
                let _ = event_tx.send(AudioEvent::TrackChanged(Some(track)));
                let _ = event_tx.send(AudioEvent::QualityUpdated(Some(quality)));
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
}

/// Duration / position / ReplayGain / track+quality events after a successful
/// gapless-backed open (exclusive or shared).
#[cfg(windows)]
fn finish_gapless_open(
    pipeline: &AudioPipeline,
    gapless: &GaplessController,
    rg: &mut ReplayGainProcessor,
    rg_config: &ReplayGainConfig,
    event_tx: &broadcast::Sender<AudioEvent>,
    track: &AudioTrack,
    quality: crate::audio::dto::QualityBadge,
) {
    let duration_ms = gapless.current_duration_ms();
    pipeline.duration_ms.store(duration_ms, Ordering::Relaxed);
    apply_position(pipeline, 0);
    rg.update(rg_config, gapless.current_replay_gain().as_ref());
    let _ = event_tx.send(AudioEvent::TrackChanged(Some(track.clone())));
    let _ = event_tx.send(AudioEvent::QualityUpdated(Some(quality)));
}

#[cfg(windows)]
fn fallback_reason_of(reasons: &[String]) -> Option<String> {
    if reasons.is_empty() {
        None
    } else {
        Some(reasons.join(" | "))
    }
}

#[cfg(windows)]
fn terminal_playback_error(reasons: &[String]) -> String {
    reasons
        .last()
        .cloned()
        .unwrap_or_else(|| "No playable audio path is available".to_string())
}

/// Advanced + ASIO is Native DSD only. PCM files still open Shared; surface
/// that so the settings status does not look like a silent WASAPI Exclusive miss.
const ASIO_PCM_SHARED_REASON: &str =
    "ASIO Native DSD applies to DSD files only; this PCM track is playing through WASAPI Shared";

fn asio_pcm_shared_reason(
    mode: PlaybackMode,
    is_dsd: bool,
    backend: AudioBackend,
) -> Option<&'static str> {
    if mode == PlaybackMode::Advanced && backend == AudioBackend::Asio && !is_dsd {
        Some(ASIO_PCM_SHARED_REASON)
    } else {
        None
    }
}

/// Software volume as currently applied by the pipeline (1.0 on endpoint paths).
#[cfg(windows)]
fn pipeline_volume(pipeline: &AudioPipeline) -> f32 {
    f32::from_bits(pipeline.volume_bits.load(Ordering::Relaxed))
}

#[cfg(windows)]
fn output_pcm_label(format: &AudioFormat) -> String {
    let encoding = match format.sample_format {
        PcmSampleFormat::F32 => "PCM 32-bit float".to_string(),
        _ => format!("PCM {}-bit", format.bit_depth),
    };
    format!(
        "{encoding} / {}",
        format_sample_rate_khz(format.sample_rate)
    )
}

/// Human label of the decoded source, e.g. `"DSD128"` / `"FLAC 24-bit / 96 kHz"`.
#[cfg(windows)]
fn source_format_label(quality: &crate::audio::dto::QualityBadge, source: &AudioFormat) -> String {
    if quality.source_type.as_deref() == Some("DSD") {
        return quality
            .dsd_rate
            .map(|rate| rate.label().to_string())
            .unwrap_or_else(|| "DSD".to_string());
    }
    format!(
        "{} {}-bit / {}",
        quality.codec_name.to_uppercase(),
        source.bit_depth,
        format_sample_rate_khz(source.sample_rate)
    )
}

/// Attempt ASIO native DSD. In Auto mode a cheap header + cached-driver check
/// runs first so missing drivers skip straight to the next plan step without
/// touching COM or tearing down the WASAPI planes.
#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn try_native_dsd(
    pipeline: &AudioPipeline,
    event_tx: &broadcast::Sender<AudioEvent>,
    track: &AudioTrack,
    generation: u64,
    control: &crate::audio::control::AudioControlHandle,
    native: &mut Option<crate::audio::asio::NativeDsdSession>,
    mode: PlaybackMode,
    reasons: &[String],
) -> crate::audio::error::AudioResult<bool> {
    use crate::audio::error::AudioError;

    if track.is_http_stream() {
        return Err(crate::audio::error::AudioError::Playback(
            "Cloud HTTP streams cannot use Native DSD or DoP; choose DSD → PCM or play a local file"
                .into(),
        ));
    }
    let path = std::path::Path::new(&track.path);
    if mode != PlaybackMode::Advanced {
        let format =
            crate::audio::dsd::probe_path(path).map_err(|error| AudioError::UnsupportedFormat {
                path: path.to_path_buf(),
                details: error.to_string(),
            })?;
        let drivers = crate::audio::asio::drivers_snapshot();
        if !drivers
            .iter()
            .any(|driver| driver.dsd_rates.contains(&format.dsd_rate))
        {
            return Err(AudioError::DeviceUnavailable(format!(
                "no installed ASIO driver supports {}",
                format.dsd_rate.label()
            )));
        }
    }

    let session = crate::audio::asio::NativeDsdSession::open(
        path,
        recover_mutex(&pipeline.asio_driver_id).as_deref(),
        Arc::clone(&pipeline.native_dsd_playing),
        control.clone(),
    )
    .inspect_err(|error| {
        let _ = control.restore_after_asio();
        pipeline.native_dsd_active.store(false, Ordering::Release);
        pipeline.native_dsd_playing.store(false, Ordering::Release);
        let _ = event_tx.send(AudioEvent::NativeDsdStatus {
            active: false,
            dsd_rate: None,
            error: Some(error.to_string()),
        });
    })?;

    if !pipeline.is_current(generation) {
        return Ok(false);
    }
    let format = session.format().clone();
    let quality = format.quality_badge(DsdOutputMode::NativeDsd);
    let source_label = format!(
        "{} • {}",
        format.dsd_rate.label(),
        quality.container_format.to_uppercase()
    );
    pipeline
        .sample_rate
        .store(format.dsd_sample_rate, Ordering::Release);
    pipeline
        .channels
        .store(u32::from(format.channels), Ordering::Release);
    pipeline
        .duration_ms
        .store(format.duration_ms, Ordering::Release);
    pipeline.native_dsd_active.store(true, Ordering::Release);
    pipeline.native_dsd_playing.store(
        pipeline.is_playing.load(Ordering::Acquire),
        Ordering::Release,
    );
    pipeline.exclusive_mode.store(false, Ordering::Release);
    pipeline.bit_perfect.store(false, Ordering::Release);
    pipeline.enter_unity_gain_volume();
    apply_position(pipeline, 0);
    *native = Some(session);
    let _ = event_tx.send(AudioEvent::TrackChanged(Some(track.clone())));
    let _ = event_tx.send(AudioEvent::QualityUpdated(Some(quality)));
    let _ = event_tx.send(AudioEvent::NativeDsdStatus {
        active: true,
        dsd_rate: Some(format.dsd_rate),
        error: None,
    });
    let dsd_mhz = format.dsd_sample_rate as f64 / 1_000_000.0;
    let _ = event_tx.send(AudioEvent::EngineStatusUpdated(EngineStatus {
        output_mode: "ASIO Native DSD".into(),
        bit_perfect: true,
        is_native: true,
        output_sample_rate: format.dsd_sample_rate,
        output_bit_depth: 1,
        source_label,
        backend: AudioBackend::Asio,
        dsd_output_mode: DsdOutputMode::NativeDsd,
        dsd_rate: Some(format.dsd_rate),
        source_format: format.dsd_rate.label().to_string(),
        source_sample_rate: format.dsd_sample_rate,
        source_bit_depth: 1,
        dsd_transport: Some(DsdOutputMode::NativeDsd),
        output_format: format!("DSD {dsd_mhz:.1} MHz (Native)"),
        volume: 1.0,
        volume_control_kind: VolumeControlKind::WindowsEndpoint,
        fallback_reason: fallback_reason_of(reasons),
        ..Default::default()
    }));
    Ok(true)
}

/// Attempt WASAPI Exclusive DoP: exact 24-bit PCM at `dsd_rate / 16` carrying
/// the unmodified DSD payload. Bit-perfect by construction (DSP fully bypassed,
/// volume on the Windows endpoint).
///
/// Only Advanced mode selects this step. Auto/HighQuality skip it because a
/// PCM-only DAC that happens to accept 176.4 kHz Exclusive will play the DoP
/// markers as audio (loud crackle / static).
#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn try_dop(
    pipeline: &AudioPipeline,
    gapless: &mut GaplessController,
    event_tx: &broadcast::Sender<AudioEvent>,
    track: &AudioTrack,
    generation: u64,
    control: &crate::audio::control::AudioControlHandle,
    dop: &mut Option<DopSession>,
    reasons: &[String],
) -> crate::audio::error::AudioResult<bool> {
    if track.is_http_stream() {
        return Err(crate::audio::error::AudioError::Playback(
            "Cloud HTTP streams cannot use Native DSD or DoP; choose DSD → PCM or play a local file"
                .into(),
        ));
    }
    let mut reader = crate::audio::dop::DopReader::open(std::path::Path::new(&track.path))?;
    let format = reader.format().clone();
    let pcm_rate = reader.pcm_rate();
    {
        let mut manager = crate::audio::wasapi::WasapiDeviceManager::new();
        if let Some(id) = recover_mutex(&pipeline.output_device)
            .as_ref()
            .map(|device| device.id.clone())
            .filter(|id| !id.is_empty() && id != "default")
        {
            manager.select_device(Some(id));
        }
        let device = manager.get_active_device()?;
        if !crate::audio::wasapi::FormatNegotiator::dop_wire_supported(
            &device,
            format.dsd_sample_rate,
        ) {
            return Err(crate::audio::error::AudioError::FormatNotSupported {
                requested: "DoP".into(),
                details: format!(
                    "{} is not available as DoP on this device",
                    format.dsd_rate.label()
                ),
            });
        }
    }
    let source = AudioFormat::s24_in_32(pcm_rate, format.channels);
    let cfg = control.enable_exclusive_for(source, true)?;
    reader.set_wire(cfg.negotiated.packed_s24);

    pipeline.request_reset();
    if !pipeline.is_current(generation) {
        return Ok(false);
    }
    gapless.clear_current();
    gapless.clear_preload();
    pipeline.exclusive_mode.store(true, Ordering::SeqCst);
    pipeline.bit_perfect.store(true, Ordering::SeqCst);
    pipeline.enter_unity_gain_volume();
    pipeline.sample_rate.store(pcm_rate, Ordering::Release);
    pipeline
        .channels
        .store(u32::from(format.channels), Ordering::Release);
    pipeline
        .duration_ms
        .store(format.duration_ms, Ordering::Release);
    apply_position(pipeline, 0);
    *dop = Some(DopSession {
        reader,
        input_done: false,
    });

    let quality = format.quality_badge(DsdOutputMode::Dop);
    let source_label = format!(
        "{} • {} • DoP",
        format.dsd_rate.label(),
        quality.container_format.to_uppercase()
    );
    let _ = event_tx.send(AudioEvent::TrackChanged(Some(track.clone())));
    let _ = event_tx.send(AudioEvent::QualityUpdated(Some(quality)));
    let _ = event_tx.send(AudioEvent::EngineStatusUpdated(EngineStatus {
        output_mode: "WASAPI Exclusive (DoP)".into(),
        bit_perfect: true,
        is_native: true,
        output_sample_rate: pcm_rate,
        output_bit_depth: 24,
        source_label,
        backend: AudioBackend::WasapiExclusive,
        dsd_output_mode: DsdOutputMode::Dop,
        dsd_rate: Some(format.dsd_rate),
        source_format: format.dsd_rate.label().to_string(),
        source_sample_rate: format.dsd_sample_rate,
        source_bit_depth: 1,
        dsd_transport: Some(DsdOutputMode::Dop),
        output_format: format!("PCM 24-bit / {} (DoP)", format_sample_rate_khz(pcm_rate)),
        volume: 1.0,
        volume_control_kind: VolumeControlKind::WindowsEndpoint,
        fallback_reason: fallback_reason_of(reasons),
        ..Default::default()
    }));
    Ok(true)
}

/// Attempt WASAPI Exclusive PCM. `bit_perfect` requests the exact source
/// format on the wire (DSP bypassed); otherwise the nearest negotiated format
/// with the regular DSP-capable decode path.
#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn try_exclusive(
    pipeline: &AudioPipeline,
    gapless: &mut GaplessController,
    eq: &mut EqualizerProcessor,
    rg: &mut ReplayGainProcessor,
    rg_config: &ReplayGainConfig,
    event_tx: &broadcast::Sender<AudioEvent>,
    track: &AudioTrack,
    generation: u64,
    control: &crate::audio::control::AudioControlHandle,
    bit_perfect: bool,
    reasons: &[String],
) -> crate::audio::error::AudioResult<bool> {
    let preloaded = if bit_perfect {
        PreloadedTrack::open_bit_perfect(track.clone())?
    } else {
        PreloadedTrack::open(track.clone())?
    };
    let quality = preloaded.quality_badge().clone();
    // A DSD source must never enter the bit-perfect PCM wire — neither as a
    // planned step nor if a caller requests ExclusiveBitPerfect by mistake.
    if bit_perfect && quality.source_type.as_deref() == Some("DSD") {
        return Err(crate::audio::error::AudioError::FormatNotSupported {
            requested: "bit-perfect PCM wire".into(),
            details: "DSD sources cannot use configure_bit_perfect_wire; use Native DSD, DoP, or DSD → PCM".into(),
        });
    }
    let mut source = preloaded.source_format();
    if quality.source_type.as_deref() == Some("DSD") {
        source = AudioFormat::f32(
            crate::audio::dsd::dsd_pcm_output_rate(source.sample_rate),
            source.channels,
        );
    }
    let cfg = control.enable_exclusive_for(source, bit_perfect)?;
    let rate = cfg.negotiated.format.sample_rate;
    let ch = cfg.negotiated.format.channels;

    gapless.set_output_spec(rate, ch);
    eq.set_output_spec(rate, ch);
    pipeline.request_reset();
    if !pipeline.is_current(generation) {
        return Ok(false);
    }
    gapless.set_current(preloaded);
    if bit_perfect {
        gapless.configure_bit_perfect_wire(
            cfg.negotiated.format,
            cfg.negotiated.packed_s24,
            cfg.negotiated.container_bytes_per_sample,
        )?;
    } else {
        gapless.set_decoder_output_format(Some(cfg.negotiated.format))?;
        // The decoder now emits at the negotiated rate; refresh Gapless so it
        // does not resample again.
        gapless.set_output_spec(rate, ch);
    }
    pipeline.exclusive_mode.store(true, Ordering::SeqCst);
    pipeline.bit_perfect.store(bit_perfect, Ordering::SeqCst);
    if bit_perfect {
        pipeline.enter_unity_gain_volume();
    } else {
        pipeline.restore_software_volume();
        let _ = event_tx.send(AudioEvent::VolumeChanged {
            volume: pipeline.applied_volume(),
            is_muted: pipeline.is_muted.load(Ordering::Relaxed),
        });
    }

    let is_dsd_source = quality.source_type.as_deref() == Some("DSD");
    let status = EngineStatus {
        output_mode: "WASAPI Exclusive".into(),
        bit_perfect,
        is_native: cfg.negotiated.is_native,
        output_sample_rate: rate,
        output_bit_depth: cfg.negotiated.format.bit_depth,
        source_label: crate::audio::control::source_label_from_format(&source, Some(&quality)),
        backend: AudioBackend::WasapiExclusive,
        dsd_output_mode: if is_dsd_source {
            DsdOutputMode::Pcm
        } else {
            quality.dsd_output_mode.unwrap_or(DsdOutputMode::Pcm)
        },
        dsd_rate: quality.dsd_rate,
        source_format: source_format_label(&quality, &source),
        source_sample_rate: if is_dsd_source {
            quality.sample_rate
        } else {
            source.sample_rate
        },
        source_bit_depth: if is_dsd_source { 1 } else { source.bit_depth },
        dsd_transport: is_dsd_source.then_some(DsdOutputMode::Pcm),
        output_format: output_pcm_label(&cfg.negotiated.format),
        volume: if bit_perfect {
            1.0
        } else {
            pipeline_volume(pipeline)
        },
        volume_control_kind: if bit_perfect {
            VolumeControlKind::WindowsEndpoint
        } else {
            VolumeControlKind::Software
        },
        fallback_reason: fallback_reason_of(reasons),
        ..Default::default()
    };
    finish_gapless_open(pipeline, gapless, rg, rg_config, event_tx, track, quality);
    let _ = event_tx.send(AudioEvent::EngineStatusUpdated(status));
    Ok(true)
}

/// Attempt WASAPI Shared (CPAL). DSD sources are always decoded to PCM here.
#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn try_shared(
    pipeline: &AudioPipeline,
    gapless: &mut GaplessController,
    eq: &mut EqualizerProcessor,
    rg: &mut ReplayGainProcessor,
    rg_config: &ReplayGainConfig,
    event_tx: &broadcast::Sender<AudioEvent>,
    track: &AudioTrack,
    generation: u64,
    control: &crate::audio::control::AudioControlHandle,
    is_dsd: bool,
    reasons: &[String],
) -> crate::audio::error::AudioResult<bool> {
    let preloaded = PreloadedTrack::open(track.clone())?;
    let quality = preloaded.quality_badge().clone();
    let source = preloaded.source_format();

    if control.exclusive_enabled() || pipeline.exclusive_mode.load(Ordering::Relaxed) {
        control.set_exclusive_mode(false, AudioFormat::s16(48_000, 2))?;
    }
    pipeline.exclusive_mode.store(false, Ordering::SeqCst);
    pipeline.bit_perfect.store(false, Ordering::SeqCst);
    pipeline.restore_software_volume();
    let _ = event_tx.send(AudioEvent::VolumeChanged {
        volume: pipeline.applied_volume(),
        is_muted: pipeline.is_muted.load(Ordering::Relaxed),
    });

    pipeline.request_reset();
    if !pipeline.is_current(generation) {
        return Ok(false);
    }
    gapless.set_current(preloaded);
    control.ensure_stream()?;
    let rate = pipeline.sample_rate.load(Ordering::Relaxed);
    let ch = pipeline.channels.load(Ordering::Relaxed) as u16;
    if is_dsd || quality.source_type.as_deref() == Some("DSD") {
        // Convert directly to the Windows mix rate in one high-quality SWR
        // pass. The DSD decoder applies an explicit ultrasonic cutoff, so a
        // second linear resample is neither needed nor desirable here.
        gapless.set_decoder_output_format(Some(AudioFormat::f32(rate, source.channels)))?;
    }
    gapless.set_output_spec(rate, ch);
    eq.set_output_spec(rate, ch);

    let is_dsd_source = quality.source_type.as_deref() == Some("DSD");
    let status = EngineStatus {
        output_mode: "WASAPI Shared".into(),
        bit_perfect: false,
        // Shared always traverses the Windows mix engine even when rates match.
        is_native: false,
        output_sample_rate: rate,
        output_bit_depth: pipeline
            .output_pcm_format()
            .map(|(format, _)| format.bit_depth)
            .unwrap_or(32),
        source_label: crate::audio::control::source_label_from_format(&source, Some(&quality)),
        backend: AudioBackend::Shared,
        dsd_output_mode: if is_dsd_source {
            DsdOutputMode::Pcm
        } else {
            quality.dsd_output_mode.unwrap_or(DsdOutputMode::Pcm)
        },
        dsd_rate: quality.dsd_rate,
        source_format: source_format_label(&quality, &source),
        source_sample_rate: if is_dsd_source {
            quality.sample_rate
        } else {
            source.sample_rate
        },
        source_bit_depth: if is_dsd_source { 1 } else { source.bit_depth },
        dsd_transport: is_dsd_source.then_some(DsdOutputMode::Pcm),
        output_format: format!(
            "PCM 32-bit float / {} (Shared)",
            format_sample_rate_khz(rate)
        ),
        volume: pipeline_volume(pipeline),
        volume_control_kind: VolumeControlKind::Software,
        fallback_reason: fallback_reason_of(reasons),
        ..Default::default()
    };
    finish_gapless_open(pipeline, gapless, rg, rg_config, event_tx, track, quality);
    let _ = event_tx.send(AudioEvent::EngineStatusUpdated(status));
    Ok(true)
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
            #[cfg(windows)]
            log_audio_wire_once(pipeline, gapless, false);
            if let Some(transition) = transitioned {
                rg.update(rg_config, gapless.current_replay_gain().as_ref());
                let occupied = {
                    let guard = recover_mutex(&pipeline.producer);
                    guard.as_ref().map(|prod| prod.occupied_len()).unwrap_or(0)
                };
                pipeline.schedule_transition(
                    ScheduledTransition {
                        track: transition.track,
                        duration_ms: gapless.current_duration_ms(),
                        quality_badge: gapless.current_quality_badge(),
                        #[cfg(windows)]
                        engine_status: engine_status_from_gapless(pipeline, gapless),
                    },
                    occupied.saturating_add(transition.sample_offset) as u64,
                );
            }

            if written > 0 {
                let buf = &mut scratch[..written];
                // DSD → PCM already has −6 dB SACD gain and a Kaiser FIR.
                // Keep the Shared path minimal and deterministic: ReplayGain
                // and EQ can destabilize very-high-rate float PCM and are not
                // part of the clean probe path used to validate conversion.
                if !gapless.current_is_dsd() {
                    rg.process_interleaved(buf);
                    eq.process_interleaved(buf);
                }
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
            stop_after_decode_error(pipeline, event_tx, err.to_string());
        }
    }
}

fn stop_after_decode_error(
    pipeline: &AudioPipeline,
    event_tx: &broadcast::Sender<AudioEvent>,
    message: String,
) {
    // A decoder cannot recover by retrying the same failed packet/context.
    // Stop once so cloud URL renewal can install a fresh decoder without a
    // tight loop flooding the UI with the same error every few milliseconds.
    if pipeline.is_playing.swap(false, Ordering::AcqRel) {
        let _ = event_tx.send(AudioEvent::ErrorOccurred(message));
        let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Stopped));
    }
}

#[cfg(windows)]
fn output_bytes_per_frame(pipeline: &AudioPipeline) -> usize {
    pipeline
        .output_pcm_format()
        .map(|(f, packed)| f.bytes_per_frame_packed(packed))
        .unwrap_or_else(|| {
            4usize.saturating_mul(pipeline.channels.load(Ordering::Relaxed).max(1) as usize)
        })
        .max(1)
}

#[cfg(windows)]
fn ring_vacant_bytes(pipeline: &AudioPipeline) -> usize {
    let guard = recover_mutex(&pipeline.pcm_producer);
    guard.as_ref().map(|prod| prod.available()).unwrap_or(0)
}

#[cfg(windows)]
fn ring_occupied_bytes(pipeline: &AudioPipeline) -> usize {
    let guard = recover_mutex(&pipeline.pcm_producer);
    guard.as_ref().map(|prod| prod.occupied()).unwrap_or(0)
}

/// Push as many leftover + new bytes as fit (frame-aligned). Retains the rest.
#[cfg(windows)]
fn push_pcm_bytes(pipeline: &AudioPipeline, leftover: &mut Vec<u8>, incoming: &[u8]) -> usize {
    if !incoming.is_empty() {
        leftover.extend_from_slice(incoming);
    }
    if leftover.is_empty() {
        return 0;
    }
    let bpf = output_bytes_per_frame(pipeline);
    debug_assert!(bpf >= 2, "stereo frame must be at least 2 bytes per sample");
    let mut guard = recover_mutex(&pipeline.pcm_producer);
    let Some(prod) = guard.as_mut() else {
        return 0;
    };
    let aligned_space = frame_aligned_len(prod.available(), bpf);
    if aligned_space == 0 {
        return 0;
    }
    let n = frame_aligned_len(leftover.len().min(aligned_space), bpf);
    if n == 0 {
        return 0;
    }
    let written = prod.push_bytes(&leftover[..n]);
    debug_assert_eq!(
        written % bpf,
        0,
        "PCM ring write must be a multiple of blockAlign={bpf}"
    );
    if written == leftover.len() {
        leftover.clear();
    } else if written > 0 {
        leftover.drain(..written);
    }
    written
}

#[cfg(windows)]
fn maybe_emit_ended(
    pipeline: &AudioPipeline,
    leftover: &[u8],
    input_drained: bool,
    drain_deadline: &mut Option<Instant>,
    event_tx: &broadcast::Sender<AudioEvent>,
) -> bool {
    if !input_drained || !leftover.is_empty() {
        return false;
    }
    let occupied = ring_occupied_bytes(pipeline);
    let deadline = *drain_deadline.get_or_insert_with(|| Instant::now() + RING_DRAIN_TIMEOUT);
    if occupied == 0 || Instant::now() >= deadline {
        pipeline.is_playing.store(false, Ordering::Relaxed);
        let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Ended));
        *drain_deadline = None;
        true
    } else {
        thread::sleep(Duration::from_millis(2));
        false
    }
}

fn emit_engine_status_cleared(pipeline: &AudioPipeline, event_tx: &broadcast::Sender<AudioEvent>) {
    let status = crate::audio::dto::EngineStatus {
        output_mode: String::new(),
        bit_perfect: pipeline.bit_perfect.load(Ordering::Relaxed),
        is_native: false,
        output_sample_rate: 0,
        output_bit_depth: 0,
        source_label: String::new(),
        ..Default::default()
    };
    let _ = event_tx.send(AudioEvent::EngineStatusUpdated(status));
}

#[cfg(windows)]
fn engine_status_from_gapless(
    pipeline: &AudioPipeline,
    gapless: &crate::audio::gapless::GaplessController,
) -> Option<EngineStatus> {
    let source = gapless.current_source_format()?;
    let quality = gapless.current_quality_badge();
    let bit_perfect = pipeline.bit_perfect.load(Ordering::Relaxed);
    let exclusive = pipeline.exclusive_mode.load(Ordering::Relaxed);
    let output_format = pipeline.output_pcm_format().map(|(f, _)| f);
    let (out_rate, out_depth) = output_format
        .map(|f| (f.sample_rate, f.bit_depth))
        .unwrap_or((source.sample_rate, source.bit_depth));
    let is_dsd_source = quality
        .as_ref()
        .is_some_and(|badge| badge.source_type.as_deref() == Some("DSD"));
    Some(crate::audio::dto::EngineStatus {
        output_mode: if exclusive {
            "WASAPI Exclusive".into()
        } else {
            "WASAPI Shared".into()
        },
        bit_perfect,
        is_native: bit_perfect
            || (source.sample_rate == out_rate
                && source.channels == pipeline.channels.load(Ordering::Relaxed) as u16),
        output_sample_rate: out_rate,
        output_bit_depth: out_depth,
        source_label: crate::audio::control::source_label_from_format(&source, quality.as_ref()),
        backend: if exclusive {
            crate::audio::dto::AudioBackend::WasapiExclusive
        } else {
            crate::audio::dto::AudioBackend::Shared
        },
        dsd_output_mode: quality
            .as_ref()
            .and_then(|badge| badge.dsd_output_mode)
            .unwrap_or(crate::audio::dto::DsdOutputMode::Pcm),
        dsd_rate: quality.as_ref().and_then(|badge| badge.dsd_rate),
        source_format: quality
            .as_ref()
            .map(|badge| source_format_label(badge, &source))
            .unwrap_or_default(),
        source_sample_rate: source.sample_rate,
        source_bit_depth: if is_dsd_source { 1 } else { source.bit_depth },
        dsd_transport: is_dsd_source.then_some(crate::audio::dto::DsdOutputMode::Pcm),
        output_format: output_format
            .map(|f| output_pcm_label(&f))
            .unwrap_or_default(),
        volume: if bit_perfect {
            1.0
        } else {
            pipeline_volume(pipeline)
        },
        volume_control_kind: if bit_perfect {
            VolumeControlKind::WindowsEndpoint
        } else {
            VolumeControlKind::Software
        },
        ..Default::default()
    })
}

#[cfg(windows)]
fn log_audio_wire_once(pipeline: &AudioPipeline, gapless: &GaplessController, exclusive: bool) {
    if pipeline.wire_logged.load(Ordering::Acquire) {
        return;
    }
    let wave_describe = recover_mutex(&pipeline.render_wave_describe)
        .clone()
        .unwrap_or_default();
    if exclusive && wave_describe.is_empty() {
        return;
    }
    if pipeline.wire_logged.swap(true, Ordering::AcqRel) {
        return;
    }
    let decoder = gapless.current_decoder();
    let badge = gapless.current_quality_badge();
    let source = decoder.map(|d| d.source_format());
    let (out_fmt, packed) = pipeline.output_pcm_format().unzip();
    let packed = packed.unwrap_or(false);
    let bpf = output_bytes_per_frame(pipeline);
    let channels = source.map(|f| f.channels).unwrap_or(2);
    tracing::info!(
        target: "audio.wire",
        codec = badge.as_ref().map(|b| b.codec_name.as_str()).unwrap_or("unknown"),
        source_rate = source.map(|f| f.sample_rate).unwrap_or(0),
        source_channels = channels,
        source_bits = decoder.map(|d| d.bit_depth()).unwrap_or(0),
        decoded_repr = decoder.map(|d| d.decoded_repr().as_str()).unwrap_or("unknown"),
        planar = decoder.map(|d| d.decoded_planar()).unwrap_or(true),
        source_layout = decoder.map(|d| d.channel_layout()).unwrap_or("FRONT_LEFT | FRONT_RIGHT"),
        exclusive,
        render_rate = out_fmt.map(|f| f.sample_rate).unwrap_or(0),
        render_channels = out_fmt.map(|f| u32::from(f.channels)).unwrap_or(0),
        w_bits = out_fmt.map(|f| if packed { 24 } else { f.bit_depth }),
        valid_bits = out_fmt.map(|f| f.bit_depth),
        block_align = bpf,
        avg_bytes_per_sec = out_fmt.map(|f| f.sample_rate.saturating_mul(bpf as u32)),
        channel_mask = if channels >= 2 { "FL|FR" } else { "FL" },
        sub_format = out_fmt.map(|f| if f.is_float() { "IEEE_FLOAT" } else { "PCM" }),
        bytes_per_frame = bpf,
        buffer_frames = pipeline.render_buffer_frames.load(Ordering::Relaxed),
        device_period_100ns = pipeline.render_period_100ns.load(Ordering::Relaxed),
        wave = wave_describe.as_str(),
        "track wire format"
    );
}

#[cfg(windows)]
fn fill_ring_bit_perfect(
    pipeline: &AudioPipeline,
    gapless: &mut GaplessController,
    byte_scratch: &mut Vec<u8>,
    leftover: &mut Vec<u8>,
    drain_deadline: &mut Option<Instant>,
    event_tx: &broadcast::Sender<AudioEvent>,
) {
    if leftover.is_empty() {
        match gapless.read_pcm_bytes(byte_scratch) {
            Ok((written, _, input_drained)) => {
                log_audio_wire_once(pipeline, gapless, true);
                if written > 0 {
                    leftover.extend_from_slice(&byte_scratch[..written]);
                    byte_scratch.clear();
                }
                push_pcm_bytes(pipeline, leftover, &[]);
                if maybe_emit_ended(pipeline, leftover, input_drained, drain_deadline, event_tx) {
                    gapless.clear_current();
                }
            }
            Err(err) => {
                stop_after_decode_error(pipeline, event_tx, err.to_string());
            }
        }
    } else {
        push_pcm_bytes(pipeline, leftover, &[]);
        if leftover.is_empty() {
            return;
        }
        thread::sleep(Duration::from_millis(2));
    }
}

/// Feed DoP-packed bytes into the exclusive PCM ring. Mirrors
/// [`fill_ring_bit_perfect`]: no DSP, no software volume, drain-then-end.
#[cfg(windows)]
fn fill_ring_dop(
    pipeline: &AudioPipeline,
    dop: &mut Option<DopSession>,
    leftover: &mut Vec<u8>,
    drain_deadline: &mut Option<Instant>,
    event_tx: &broadcast::Sender<AudioEvent>,
) {
    let Some(session) = dop.as_mut() else {
        return;
    };
    if !leftover.is_empty() {
        push_pcm_bytes(pipeline, leftover, &[]);
        if !leftover.is_empty() {
            thread::sleep(Duration::from_millis(2));
            return;
        }
    }

    let mut failure: Option<String> = None;
    if !session.input_done {
        // Read only when the ring can take a meaningful amount so `leftover`
        // does not balloon far ahead of the device.
        if ring_vacant_bytes(pipeline) < 4096 {
            thread::sleep(Duration::from_millis(2));
            return;
        }
        match session.reader.next_dop_bytes() {
            Ok(Some(bytes)) => {
                push_pcm_bytes(pipeline, leftover, &bytes);
            }
            Ok(None) => session.input_done = true,
            Err(err) => failure = Some(err.to_string()),
        }
    }

    if let Some(message) = failure {
        dop.take();
        pipeline.is_playing.store(false, Ordering::Release);
        let _ = event_tx.send(AudioEvent::ErrorOccurred(message));
        let _ = event_tx.send(AudioEvent::StateChanged(PlaybackState::Stopped));
        return;
    }

    let input_done = session.input_done;
    if maybe_emit_ended(pipeline, leftover, input_done, drain_deadline, event_tx) {
        dop.take();
    }
}

#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn fill_ring_wasapi(
    pipeline: &AudioPipeline,
    gapless: &mut GaplessController,
    eq: &mut EqualizerProcessor,
    rg: &mut ReplayGainProcessor,
    rg_config: &ReplayGainConfig,
    scratch: &mut [f32],
    pcm_scratch: &mut Vec<u8>,
    leftover: &mut Vec<u8>,
    drain_deadline: &mut Option<Instant>,
    event_tx: &broadcast::Sender<AudioEvent>,
) {
    if !leftover.is_empty() {
        push_pcm_bytes(pipeline, leftover, &[]);
        if !leftover.is_empty() {
            thread::sleep(Duration::from_millis(2));
            return;
        }
    }

    let vacant = ring_vacant_bytes(pipeline);
    let bpf = output_bytes_per_frame(pipeline);
    if vacant < bpf {
        thread::sleep(Duration::from_millis(2));
        return;
    }

    let channels = pipeline.channels.load(Ordering::Relaxed).max(1) as usize;
    let max_frames = (vacant / bpf)
        .min(scratch.len() / channels.max(1))
        .min(4096);
    let max_samples = max_frames.saturating_mul(channels);
    if max_samples == 0 {
        thread::sleep(Duration::from_millis(2));
        return;
    }

    match gapless.read_samples(&mut scratch[..max_samples]) {
        Ok((written, transitioned, is_eof)) => {
            log_audio_wire_once(pipeline, gapless, true);
            if let Some(transition) = transitioned {
                rg.update(rg_config, gapless.current_replay_gain().as_ref());
                let occupied = ring_occupied_bytes(pipeline);
                let bpf = output_bytes_per_frame(pipeline);
                let samples_ahead = (occupied / bpf)
                    .saturating_mul(pipeline.channels.load(Ordering::Relaxed) as usize);
                pipeline.schedule_transition(
                    ScheduledTransition {
                        track: transition.track,
                        duration_ms: gapless.current_duration_ms(),
                        quality_badge: gapless.current_quality_badge(),
                        engine_status: engine_status_from_gapless(pipeline, gapless),
                    },
                    samples_ahead.saturating_add(transition.sample_offset) as u64,
                );
            }

            if written > 0 {
                let buf = &mut scratch[..written];
                rg.process_interleaved(buf);
                eq.process_interleaved(buf);
                let volume = f32::from_bits(pipeline.volume_bits.load(Ordering::Relaxed));
                if (volume - 1.0).abs() > 0.001 {
                    for sample in buf.iter_mut() {
                        *sample *= volume;
                    }
                }
                soft_limit(buf);

                if let Some((format, packed_s24)) = pipeline.output_pcm_format() {
                    f32_to_pcm_bytes(buf, &format, packed_s24, pcm_scratch);
                    push_pcm_bytes(pipeline, leftover, pcm_scratch);
                }
            }

            if maybe_emit_ended(pipeline, leftover, is_eof, drain_deadline, event_tx) {
                gapless.clear_current();
            }
        }
        Err(err) => {
            stop_after_decode_error(pipeline, event_tx, err.to_string());
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

    #[test]
    fn seek_mailbox_keeps_only_latest_request() {
        let (pipeline, _cons, _tx, _rx) = AudioPipeline::create();
        let generation = pipeline.next_generation();
        for position in 0..10_000 {
            pipeline.request_seek(position, generation);
        }
        assert_eq!(pipeline.take_pending_seek(), Some((9_999, generation)));
        assert_eq!(pipeline.take_pending_seek(), None);
    }

    #[test]
    fn ring_capacity_tracks_output_spec() {
        assert_eq!(ring_capacity_samples(48_000, 2), 33_600);
        assert_eq!(ring_capacity_samples(192_000, 8), 537_600);
    }

    #[test]
    fn auto_dsd_plan_falls_back_native_pcm_shared() {
        let plan = resolve_plan(
            PlaybackMode::Auto,
            true,
            AudioBackend::Shared,
            DsdOutputMode::Pcm,
        );
        assert_eq!(plan, vec![PlanStep::ExclusivePcm, PlanStep::Shared]);
        assert!(!plan.contains(&PlanStep::Dop));
        assert!(!plan.contains(&PlanStep::NativeDsd));
    }

    #[test]
    fn auto_pcm_plan_has_no_asio_branch_and_ends_shared() {
        let plan = resolve_plan(
            PlaybackMode::Auto,
            false,
            AudioBackend::Shared,
            DsdOutputMode::Pcm,
        );
        assert!(!plan.contains(&PlanStep::NativeDsd));
        assert!(!plan.contains(&PlanStep::Dop));
        assert_eq!(plan.first(), Some(&PlanStep::ExclusiveBitPerfect));
        assert_eq!(plan.last(), Some(&PlanStep::Shared));
    }

    #[test]
    fn high_quality_dsd_never_enters_bit_perfect_wire() {
        let plan = resolve_plan(
            PlaybackMode::HighQuality,
            true,
            AudioBackend::WasapiExclusive,
            DsdOutputMode::Pcm,
        );
        assert_eq!(plan, vec![PlanStep::ExclusivePcm, PlanStep::Shared]);
        assert!(!plan.contains(&PlanStep::ExclusiveBitPerfect));
        assert!(!plan.contains(&PlanStep::Dop));
    }

    #[test]
    fn dsd_sources_never_plan_the_bit_perfect_pcm_wire_in_any_mode() {
        for mode in [
            PlaybackMode::Auto,
            PlaybackMode::HighQuality,
            PlaybackMode::Multitask,
            PlaybackMode::Advanced,
        ] {
            for backend in [
                AudioBackend::Shared,
                AudioBackend::WasapiExclusive,
                AudioBackend::Asio,
            ] {
                for transport in [
                    DsdOutputMode::NativeDsd,
                    DsdOutputMode::Dop,
                    DsdOutputMode::Pcm,
                ] {
                    let plan = resolve_plan(mode, true, backend, transport);
                    assert!(
                        !plan.contains(&PlanStep::ExclusiveBitPerfect),
                        "DSD plan for {mode:?}/{backend:?}/{transport:?} must not \
                         use configure_bit_perfect_wire"
                    );
                    assert!(!plan.is_empty());
                }
            }
        }
    }

    #[test]
    fn multitask_is_always_shared_only() {
        for is_dsd in [true, false] {
            let plan = resolve_plan(
                PlaybackMode::Multitask,
                is_dsd,
                AudioBackend::Asio,
                DsdOutputMode::NativeDsd,
            );
            assert_eq!(plan, vec![PlanStep::Shared]);
        }
    }

    #[test]
    fn advanced_is_strict_single_path_for_dsd() {
        assert_eq!(
            resolve_plan(
                PlaybackMode::Advanced,
                true,
                AudioBackend::Asio,
                DsdOutputMode::NativeDsd
            ),
            vec![PlanStep::NativeDsd]
        );
        assert_eq!(
            resolve_plan(
                PlaybackMode::Advanced,
                true,
                AudioBackend::WasapiExclusive,
                DsdOutputMode::Dop
            ),
            vec![PlanStep::Dop]
        );
        assert_eq!(
            resolve_plan(
                PlaybackMode::Advanced,
                true,
                AudioBackend::WasapiExclusive,
                DsdOutputMode::Pcm
            ),
            vec![PlanStep::ExclusivePcm]
        );
        assert_eq!(
            resolve_plan(
                PlaybackMode::Advanced,
                true,
                AudioBackend::Shared,
                DsdOutputMode::Pcm
            ),
            vec![PlanStep::Shared]
        );
        assert_eq!(
            resolve_plan(
                PlaybackMode::Advanced,
                true,
                AudioBackend::Shared,
                DsdOutputMode::Dop
            ),
            vec![PlanStep::Shared]
        );
    }

    #[test]
    fn advanced_pcm_with_asio_backend_routes_to_shared_not_fake_asio_pcm() {
        let plan = resolve_plan(
            PlaybackMode::Advanced,
            false,
            AudioBackend::Asio,
            DsdOutputMode::NativeDsd,
        );
        assert_eq!(plan, vec![PlanStep::Shared]);
        assert_eq!(
            asio_pcm_shared_reason(PlaybackMode::Advanced, false, AudioBackend::Asio),
            Some(ASIO_PCM_SHARED_REASON)
        );
        assert_eq!(
            asio_pcm_shared_reason(PlaybackMode::Advanced, true, AudioBackend::Asio),
            None
        );
        assert_eq!(
            asio_pcm_shared_reason(PlaybackMode::Advanced, false, AudioBackend::WasapiExclusive),
            None
        );
    }

    #[test]
    fn advanced_dsd512_dop_never_silently_converts_to_pcm() {
        let plan = resolve_plan_for_source(
            PlaybackMode::Advanced,
            true,
            AudioBackend::WasapiExclusive,
            DsdOutputMode::Dop,
            Some(crate::audio::dto::DsdRate::Dsd512),
            false,
            false,
        );
        assert_eq!(plan, vec![PlanStep::Dop]);
    }

    #[test]
    fn gapless_does_not_hide_pcm_to_native_dsd_route_change() {
        assert!(!can_reuse_route_for_gapless(
            PlaybackMode::Advanced,
            true,
            AudioBackend::Asio,
            DsdOutputMode::NativeDsd,
            PlanStep::Shared,
        ));
    }

    #[test]
    fn gapless_reuses_only_the_preferred_pcm_route() {
        assert!(can_reuse_route_for_gapless(
            PlaybackMode::Multitask,
            true,
            AudioBackend::Shared,
            DsdOutputMode::Pcm,
            PlanStep::Shared,
        ));
        assert!(!can_reuse_route_for_gapless(
            PlaybackMode::Auto,
            false,
            AudioBackend::Shared,
            DsdOutputMode::Pcm,
            PlanStep::Shared,
        ));
        assert!(!can_reuse_route_for_gapless(
            PlaybackMode::Advanced,
            true,
            AudioBackend::WasapiExclusive,
            DsdOutputMode::Dop,
            PlanStep::Dop,
        ));
    }

    #[cfg(windows)]
    #[test]
    fn terminal_error_uses_the_last_failed_fallback() {
        let reasons = vec![
            "WASAPI Exclusive bit-perfect: Format not supported by DAC (PCM 24-bit / 96 kHz)"
                .to_string(),
            "WASAPI Shared: Audio format unsupported for path broken.dsf: invalid DSF header"
                .to_string(),
        ];

        assert_eq!(terminal_playback_error(&reasons), reasons[1]);
        assert_eq!(
            terminal_playback_error(&[]),
            "No playable audio path is available"
        );
    }

    #[test]
    fn realtime_fill_records_underruns() {
        let (pipeline, mut cons, _tx, _rx) = AudioPipeline::create();
        pipeline.is_playing.store(true, Ordering::Relaxed);
        let mut output = [1.0; 64];
        realtime_fill(&mut output, &mut cons, &pipeline);
        assert_eq!(pipeline.underrun_stats(), (1, 64));
        assert!(output.iter().all(|sample| *sample == 0.0));
    }

    #[test]
    fn unity_gain_restores_user_software_volume() {
        let (pipeline, _cons, _tx, _rx) = AudioPipeline::create();
        pipeline.store_user_volume(0.25, true, true);
        assert!((pipeline.applied_volume() - 0.25).abs() < 0.0001);
        pipeline.enter_unity_gain_volume();
        assert!((pipeline.applied_volume() - 1.0).abs() < 0.0001);
        assert!(!pipeline.is_muted.load(Ordering::Relaxed));
        pipeline.restore_software_volume();
        assert!((pipeline.applied_volume() - 0.25).abs() < 0.0001);
        assert!(pipeline.is_muted.load(Ordering::Relaxed));
    }
}
