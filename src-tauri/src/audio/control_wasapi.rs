//! Windows control thread: owns WASAPI device manager + exclusive output.

use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crossbeam_channel::{Receiver, Sender};
use tokio::sync::broadcast;

use crate::audio::dto::{AudioDeviceDTO, AudioEvent, QualityBadge};
use crate::audio::error::{AudioError, AudioResult};
use crate::audio::pcm::{format_sample_rate_khz, AudioFormat};
use crate::audio::pcm_ring::PcmRing;
use crate::audio::pipeline::{AudioPipeline, DecodeCommand};
use crate::audio::wasapi::{
    FormatNegotiator, NegotiatedFormat, WasapiDeviceManager, WasapiExclusiveOutput,
};
use crate::sync_util::recover_mutex;

const CONTROL_COMMAND_CAPACITY: usize = 16;

/// Result of exclusive format negotiation + stream open.
#[derive(Debug, Clone)]
pub struct ConfigureResult {
    pub negotiated: NegotiatedFormat,
    pub device: AudioDeviceDTO,
}

enum ControlCommand {
    SelectDevice(Option<String>, Sender<AudioResult<()>>),
    EnumerateDevices(Sender<AudioResult<Vec<AudioDeviceDTO>>>),
    GetEndpointAudioState(Sender<AudioResult<(f32, bool)>>),
    SetEndpointVolume(f32, Sender<AudioResult<()>>),
    SetEndpointMuted(bool, Sender<AudioResult<()>>),
    ConfigureExclusive {
        source: AudioFormat,
        bit_perfect: bool,
        reply: Sender<AudioResult<ConfigureResult>>,
    },
    IsActive(Sender<bool>),
    SetPaused(bool),
    Disable(Sender<AudioResult<()>>),
    Shutdown,
}

/// Sendable facade for the dedicated thread that owns WASAPI objects.
pub struct AudioControlHandle {
    tx: Sender<ControlCommand>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Clone for AudioControlHandle {
    fn clone(&self) -> Self {
        Self {
            tx: self.tx.clone(),
            thread: Mutex::new(None),
        }
    }
}

impl AudioControlHandle {
    pub fn spawn(
        pipeline: Arc<AudioPipeline>,
        decode_tx: Sender<DecodeCommand>,
        event_tx: broadcast::Sender<AudioEvent>,
    ) -> Self {
        let (tx, rx) = crossbeam_channel::bounded(CONTROL_COMMAND_CAPACITY);
        let thread = thread::Builder::new()
            .name("audio-control".into())
            .spawn(move || control_loop(rx, pipeline, decode_tx, event_tx))
            .ok();
        Self {
            tx,
            thread: Mutex::new(thread),
        }
    }

    fn request<T>(
        &self,
        build: impl FnOnce(Sender<AudioResult<T>>) -> ControlCommand,
    ) -> AudioResult<T> {
        let (reply_tx, reply_rx) = crossbeam_channel::bounded(1);
        self.tx
            .send(build(reply_tx))
            .map_err(|_| AudioError::Playback("Audio control thread is unavailable".into()))?;
        reply_rx
            .recv()
            .map_err(|_| AudioError::Playback("Audio control thread stopped unexpectedly".into()))?
    }

    pub fn select_device(&self, name: Option<String>) -> AudioResult<()> {
        self.request(|reply| ControlCommand::SelectDevice(name, reply))
    }

    pub fn enumerate_devices(&self) -> AudioResult<Vec<AudioDeviceDTO>> {
        self.request(ControlCommand::EnumerateDevices)
    }

    pub fn endpoint_audio_state(&self) -> AudioResult<(f32, bool)> {
        self.request(ControlCommand::GetEndpointAudioState)
    }

    pub fn set_endpoint_volume(&self, volume: f32) -> AudioResult<()> {
        self.request(|reply| ControlCommand::SetEndpointVolume(volume, reply))
    }

    pub fn set_endpoint_muted(&self, muted: bool) -> AudioResult<()> {
        self.request(|reply| ControlCommand::SetEndpointMuted(muted, reply))
    }

    pub fn configure_exclusive(
        &self,
        source: AudioFormat,
        bit_perfect: bool,
    ) -> AudioResult<ConfigureResult> {
        self.request(|reply| ControlCommand::ConfigureExclusive {
            source,
            bit_perfect,
            reply,
        })
    }

    pub fn is_active(&self) -> bool {
        let (reply_tx, reply_rx) = crossbeam_channel::bounded(1);
        if self.tx.send(ControlCommand::IsActive(reply_tx)).is_err() {
            return false;
        }
        reply_rx.recv().unwrap_or(false)
    }

    pub fn set_paused(&self, paused: bool) {
        let _ = self.tx.send(ControlCommand::SetPaused(paused));
    }

    pub fn disable(&self) -> AudioResult<()> {
        self.request(ControlCommand::Disable)
    }

    pub fn shutdown(&self) {
        let _ = self.tx.send(ControlCommand::Shutdown);
        if let Some(handle) = recover_mutex(&self.thread).take() {
            let _ = handle.join();
        }
    }
}

impl Drop for AudioControlHandle {
    fn drop(&mut self) {
        // Only the owning handle (with a JoinHandle) should shut the thread down.
        if recover_mutex(&self.thread).is_some() {
            self.shutdown();
        }
    }
}

fn control_loop(
    rx: Receiver<ControlCommand>,
    pipeline: Arc<AudioPipeline>,
    _decode_tx: Sender<DecodeCommand>,
    event_tx: broadcast::Sender<AudioEvent>,
) {
    let mut manager = WasapiDeviceManager::new();
    let mut active_output: Option<WasapiExclusiveOutput> = None;
    let mut last_cfg: Option<(AudioFormat, bool)> = None;

    while let Ok(command) = rx.recv() {
        match command {
            ControlCommand::SelectDevice(id, reply) => {
                if let Some(mut out) = active_output.take() {
                    let _ = out.stop();
                }
                manager.select_device(id);
                if let Ok(endpoint) = manager.resolve_active_endpoint_id() {
                    tracing::info!(
                        target: "wasapi",
                        endpoint = %endpoint,
                        selected = ?manager.selected_device_id(),
                        "exclusive device selection updated"
                    );
                }
                let _ = reply.send(Ok(()));
            }
            ControlCommand::EnumerateDevices(reply) => {
                let _ = reply.send(manager.enumerate_devices());
            }
            ControlCommand::GetEndpointAudioState(reply) => {
                let _ = reply.send(manager.endpoint_audio_state());
            }
            ControlCommand::SetEndpointVolume(volume, reply) => {
                let _ = reply.send(manager.set_endpoint_volume(volume));
            }
            ControlCommand::SetEndpointMuted(muted, reply) => {
                let _ = reply.send(manager.set_endpoint_muted(muted));
            }
            ControlCommand::ConfigureExclusive {
                source,
                bit_perfect,
                reply,
            } => {
                last_cfg = Some((source, bit_perfect));
                let result = configure_exclusive(
                    &mut manager,
                    &mut active_output,
                    &pipeline,
                    &event_tx,
                    source,
                    bit_perfect,
                );
                let _ = reply.send(result);
            }
            ControlCommand::IsActive(reply) => {
                let active = active_output.as_ref().is_some_and(|out| out.is_running());
                let _ = reply.send(active);
            }
            ControlCommand::SetPaused(paused) => {
                if paused {
                    if let Some(ref mut out) = active_output {
                        out.pause();
                    }
                } else if let Some(ref mut out) = active_output {
                    out.resume();
                } else if let Some((source, bit_perfect)) = last_cfg {
                    // Device was changed while paused (stream torn down). Reopen
                    // exclusive output so resume can play.
                    let result = configure_exclusive(
                        &mut manager,
                        &mut active_output,
                        &pipeline,
                        &event_tx,
                        source,
                        bit_perfect,
                    );
                    if let Err(err) = result {
                        let _ = event_tx.send(AudioEvent::ErrorOccurred(err.to_string()));
                    }
                }
            }
            ControlCommand::Disable(reply) => {
                if let Some(mut out) = active_output.take() {
                    let _ = out.stop();
                }
                last_cfg = None;
                tracing::info!(
                    target: "wasapi",
                    "WASAPI Exclusive output stopped; Shared may resume"
                );
                let _ = reply.send(Ok(()));
            }
            ControlCommand::Shutdown => {
                if let Some(mut out) = active_output.take() {
                    let _ = out.stop();
                }
                break;
            }
        }
    }
}

fn configure_exclusive(
    manager: &mut WasapiDeviceManager,
    active_output: &mut Option<WasapiExclusiveOutput>,
    pipeline: &Arc<AudioPipeline>,
    event_tx: &broadcast::Sender<AudioEvent>,
    source: AudioFormat,
    bit_perfect: bool,
) -> AudioResult<ConfigureResult> {
    if let Some(mut out) = active_output.take() {
        let _ = out.stop();
    }

    pipeline.clear_pcm_producer();
    pipeline
        .wire_logged
        .store(false, std::sync::atomic::Ordering::Relaxed);

    let device = manager.get_active_device()?;
    let endpoint = crate::audio::wasapi::device::device_id_string(&device)?;
    tracing::info!(
        target: "wasapi",
        endpoint = %endpoint,
        source = %source.describe(),
        bit_perfect,
        "configuring WASAPI Exclusive"
    );

    let negotiated = FormatNegotiator::negotiate(&device, &source, bit_perfect)?;

    let ring = PcmRing::for_wire(negotiated.format.sample_rate, negotiated.bytes_per_frame());
    let (producer, consumer) = ring.split();
    pipeline.set_pcm_producer(producer);

    let device_dto = current_device_dto(manager, &device)?;

    let mut output = WasapiExclusiveOutput::open(&device, negotiated.clone())?;
    let event_tx_err = event_tx.clone();
    output.set_error_callback(Some(Arc::new(move |err: AudioError| {
        let msg = err.to_string();
        match err {
            AudioError::DeviceUnavailable(_) => {
                let _ = event_tx_err.send(AudioEvent::DeviceLost(msg.clone()));
                let _ = event_tx_err.send(AudioEvent::ExclusiveModeChanged {
                    enabled: false,
                    output_mode: "WASAPI Shared".into(),
                    error: Some(msg),
                });
            }
            _ => {
                let _ = event_tx_err.send(AudioEvent::ErrorOccurred(msg));
            }
        }
    })));

    output.start(
        consumer,
        Arc::clone(&pipeline.pending_reset_flag()),
        Some(Arc::clone(pipeline)),
    )?;

    if !pipeline
        .is_playing
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        output.pause();
    }

    pipeline.sample_rate.store(
        negotiated.format.sample_rate,
        std::sync::atomic::Ordering::Relaxed,
    );
    pipeline.channels.store(
        u32::from(negotiated.format.channels),
        std::sync::atomic::Ordering::Relaxed,
    );
    pipeline.set_output_pcm_format(negotiated.format, negotiated.packed_s24);
    pipeline.set_output_device(device_dto.clone());

    *active_output = Some(output);

    tracing::info!(
        target: "wasapi",
        endpoint = %endpoint,
        output_mode = "WASAPI Exclusive",
        rate = negotiated.format.sample_rate,
        bit_depth = negotiated.format.bit_depth,
        "exclusive output mode is running"
    );

    Ok(ConfigureResult {
        negotiated,
        device: device_dto,
    })
}

fn current_device_dto(
    manager: &WasapiDeviceManager,
    device: &windows::Win32::Media::Audio::IMMDevice,
) -> AudioResult<AudioDeviceDTO> {
    use crate::audio::wasapi::device::{device_friendly_name, device_id_string};

    let id = device_id_string(device)?;
    let name = device_friendly_name(device).unwrap_or_else(|_| id.clone());
    let is_default = manager.selected_device_id().is_none();
    let (sample_rates, channels, bit_depths) =
        FormatNegotiator::probe_supported_cached(device, &id)
            .unwrap_or_else(|_| (vec![44_100, 48_000], vec![2], vec![16, 24, 32]));

    Ok(AudioDeviceDTO {
        id,
        name,
        is_default,
        is_current: true,
        sample_rates,
        bit_depths,
        channels,
        backend: crate::audio::dto::AudioBackend::WasapiExclusive,
        asio_driver_id: None,
        native_dsd_supported: false,
        dsd_rates: Vec::new(),
    })
}

pub fn source_label_from_format(format: &AudioFormat, badge: Option<&QualityBadge>) -> String {
    if let Some(badge) = badge.filter(|badge| badge.source_type.as_deref() == Some("DSD")) {
        let rate = badge.dsd_rate.map(|value| value.label()).unwrap_or("DSD");
        let container = badge.container_format.to_uppercase();
        let mode = match badge.dsd_output_mode {
            Some(crate::audio::dto::DsdOutputMode::NativeDsd) => "ASIO Native DSD",
            Some(crate::audio::dto::DsdOutputMode::Dop) => "DoP",
            _ => "DSD → PCM",
        };
        return format!("{rate} • {container} • {mode} • {} ch", format.channels);
    }
    let codec = badge
        .map(|b| b.codec_name.to_uppercase())
        .unwrap_or_else(|| "PCM".into());
    let ch = match format.channels {
        1 => "Mono",
        2 => "Stereo",
        n => {
            return format!(
                "{codec} • {}-bit • {} • {n} ch",
                format.bit_depth,
                format_sample_rate_khz(format.sample_rate)
            )
        }
    };
    format!(
        "{codec} • {}-bit • {} • {ch}",
        format.bit_depth,
        format_sample_rate_khz(format.sample_rate)
    )
}
