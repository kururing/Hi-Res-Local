use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{BufferSize, SampleFormat, Stream, StreamConfig};
use crossbeam_channel::{Receiver, Sender};
use ringbuf::HeapCons;
use tokio::sync::broadcast;

use crate::audio::device::{convert_f32_to_i16, convert_f32_to_u16, OutputDeviceManager};
use crate::audio::dto::{AudioDeviceDTO, AudioEvent};
use crate::audio::error::{AudioError, AudioResult};
use crate::audio::pipeline::{device_buffer_frames, realtime_fill, AudioPipeline, DecodeCommand};
use crate::sync_util::recover_mutex;

const CONTROL_COMMAND_CAPACITY: usize = 16;

enum ControlCommand {
    EnsureStream(Sender<AudioResult<()>>),
    SelectDevice(Option<String>, Sender<AudioResult<()>>),
    EnumerateDevices(Sender<AudioResult<Vec<AudioDeviceDTO>>>),
    Shutdown,
}

/// Sendable facade for the dedicated thread that exclusively owns CPAL host,
/// device and stream objects. No CPAL object crosses a thread boundary.
pub struct AudioControlHandle {
    tx: Sender<ControlCommand>,
    thread: Mutex<Option<JoinHandle<()>>>,
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

    pub fn ensure_stream(&self) -> AudioResult<()> {
        self.request(ControlCommand::EnsureStream)
    }

    pub fn select_device(&self, name: Option<String>) -> AudioResult<()> {
        self.request(|reply| ControlCommand::SelectDevice(name, reply))
    }

    pub fn enumerate_devices(&self) -> AudioResult<Vec<AudioDeviceDTO>> {
        self.request(ControlCommand::EnumerateDevices)
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
        self.shutdown();
    }
}

fn control_loop(
    rx: Receiver<ControlCommand>,
    pipeline: Arc<AudioPipeline>,
    decode_tx: Sender<DecodeCommand>,
    event_tx: broadcast::Sender<AudioEvent>,
) {
    let mut manager = OutputDeviceManager::new();
    let mut active_stream: Option<Stream> = None;

    while let Ok(command) = rx.recv() {
        match command {
            ControlCommand::EnsureStream(reply) => {
                let result = if active_stream.is_some() {
                    Ok(())
                } else {
                    create_stream(&manager, &pipeline, &decode_tx, &event_tx)
                        .map(|stream| active_stream = Some(stream))
                };
                let _ = reply.send(result);
            }
            ControlCommand::SelectDevice(name, reply) => {
                active_stream = None;
                manager.select_device(name);
                let result = create_stream(&manager, &pipeline, &decode_tx, &event_tx)
                    .map(|stream| active_stream = Some(stream));
                let _ = reply.send(result);
            }
            ControlCommand::EnumerateDevices(reply) => {
                let _ = reply.send(manager.enumerate_devices());
            }
            ControlCommand::Shutdown => break,
        }
    }
}

fn create_stream(
    manager: &OutputDeviceManager,
    pipeline: &Arc<AudioPipeline>,
    decode_tx: &Sender<DecodeCommand>,
    event_tx: &broadcast::Sender<AudioEvent>,
) -> AudioResult<Stream> {
    let device = manager.get_active_device()?;
    let supported_config = OutputDeviceManager::get_best_output_config(&device)?;
    let sample_format = supported_config.sample_format();
    let mut config: StreamConfig = supported_config.into();
    let sample_rate = config.sample_rate.0;
    let channels = config.channels;
    config.buffer_size = BufferSize::Fixed(device_buffer_frames(sample_rate));

    pipeline
        .sample_rate
        .store(sample_rate, std::sync::atomic::Ordering::Relaxed);
    pipeline
        .channels
        .store(channels as u32, std::sync::atomic::Ordering::Relaxed);
    decode_tx
        .send(DecodeCommand::SetOutputSpec {
            sample_rate,
            channels,
        })
        .map_err(|_| AudioError::Playback("Decode thread is unavailable".into()))?;

    let cons = pipeline.recreate_ring(sample_rate, channels);
    let stream = match build_stream(
        &device,
        &config,
        sample_format,
        cons,
        Arc::clone(pipeline),
        event_tx.clone(),
    ) {
        Ok(stream) => stream,
        Err(_) => {
            config.buffer_size = BufferSize::Default;
            let cons = pipeline.recreate_ring(sample_rate, channels);
            build_stream(
                &device,
                &config,
                sample_format,
                cons,
                Arc::clone(pipeline),
                event_tx.clone(),
            )?
        }
    };
    stream
        .play()
        .map_err(|error| AudioError::StreamError(error.to_string()))?;
    Ok(stream)
}

fn build_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    mut cons: HeapCons<f32>,
    pipeline: Arc<AudioPipeline>,
    event_tx: broadcast::Sender<AudioEvent>,
) -> AudioResult<Stream> {
    let stream = match sample_format {
        SampleFormat::F32 => device.build_output_stream(
            config,
            move |data: &mut [f32], _| realtime_fill(data, &mut cons, &pipeline),
            move |error| report_stream_error(error, &event_tx),
            None,
        ),
        SampleFormat::I16 => device.build_output_stream(
            config,
            move |data: &mut [i16], _| {
                let mut scratch = [0.0f32; 512];
                for chunk in data.chunks_mut(scratch.len()) {
                    let samples = &mut scratch[..chunk.len()];
                    realtime_fill(samples, &mut cons, &pipeline);
                    for (target, sample) in chunk.iter_mut().zip(samples.iter().copied()) {
                        *target = convert_f32_to_i16(sample);
                    }
                }
            },
            move |error| report_stream_error(error, &event_tx),
            None,
        ),
        SampleFormat::U16 => device.build_output_stream(
            config,
            move |data: &mut [u16], _| {
                let mut scratch = [0.0f32; 512];
                for chunk in data.chunks_mut(scratch.len()) {
                    let samples = &mut scratch[..chunk.len()];
                    realtime_fill(samples, &mut cons, &pipeline);
                    for (target, sample) in chunk.iter_mut().zip(samples.iter().copied()) {
                        *target = convert_f32_to_u16(sample);
                    }
                }
            },
            move |error| report_stream_error(error, &event_tx),
            None,
        ),
        _ => {
            return Err(AudioError::StreamInitialization(
                "Unsupported CPAL sample format".into(),
            ))
        }
    }
    .map_err(|error| AudioError::StreamInitialization(error.to_string()))?;
    Ok(stream)
}

fn report_stream_error(error: cpal::StreamError, event_tx: &broadcast::Sender<AudioEvent>) {
    tracing::error!("CPAL audio stream error: {error}");
    let _ = event_tx.send(AudioEvent::DeviceLost(error.to_string()));
}
