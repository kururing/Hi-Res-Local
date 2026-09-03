//! Event-driven WASAPI exclusive render output.
//!
//! Control methods (`start` / `stop` / `pause` / `reinitialize`) may run on the
//! audio control thread. The dedicated render thread owns `IAudioClient`,
//! initializes COM with `CoInitializeEx`, and pulls interleaved PCM bytes from
//! a [`PcmRingConsumer`].
//!
//! `IMMDevice` / `IAudioClient` are **not** `Send` in the `windows` 0.61 crate,
//! so the render thread re-opens the endpoint by device id string.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use crossbeam_channel::{bounded, Sender};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioClient, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED,
    AUDCLNT_E_DEVICE_INVALIDATED, AUDCLNT_E_DEVICE_IN_USE, AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED,
    AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, WAVEFORMATEX,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForMultipleObjects};

use crate::audio::error::{AudioError, AudioResult};
use crate::audio::pcm_ring::PcmRingConsumer;
use crate::audio::pipeline::AudioPipeline;
use crate::audio::wasapi::device::{device_id_string, ensure_com, ensure_com_guard};
use crate::audio::wasapi::format::NegotiatedFormat;

/// Optional device/stream error sink shared with the control plane.
pub type DeviceErrorCallback = Arc<dyn Fn(AudioError) + Send + Sync + 'static>;

/// Exclusive-mode WASAPI output driven by a buffer event + PCM byte ring.
pub struct WasapiExclusiveOutput {
    /// Endpoint id captured at [`Self::open`] (Send-safe across threads).
    device_id: String,
    negotiated: NegotiatedFormat,
    running: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    /// Underrun events (partial or full silence fills).
    pub underrun_count: Arc<AtomicU64>,
    /// Total frames filled with silence due to underrun.
    pub underrun_frames: Arc<AtomicU64>,
    stop_event: Option<SendHandle>,
    thread: Option<JoinHandle<()>>,
    on_error: Option<DeviceErrorCallback>,
}

/// `HANDLE` wrapper that is explicitly `Send` for the render thread.
#[derive(Clone, Copy)]
struct SendHandle(isize);

impl SendHandle {
    fn from_handle(h: HANDLE) -> Self {
        Self(h.0 as isize)
    }

    fn as_handle(self) -> HANDLE {
        HANDLE(self.0 as _)
    }
}

// SAFETY: Windows event HANDLEs may be waited/signaled across threads.
unsafe impl Send for SendHandle {}

impl WasapiExclusiveOutput {
    /// Bind an exclusive format to a render endpoint (does not start I/O yet).
    pub fn open(device: &IMMDevice, negotiated: NegotiatedFormat) -> AudioResult<Self> {
        ensure_com()?;
        let device_id = device_id_string(device)?;
        Ok(Self {
            device_id,
            negotiated,
            running: Arc::new(AtomicBool::new(false)),
            paused: Arc::new(AtomicBool::new(false)),
            underrun_count: Arc::new(AtomicU64::new(0)),
            underrun_frames: Arc::new(AtomicU64::new(0)),
            stop_event: None,
            thread: None,
            on_error: None,
        })
    }

    /// Open using a previously resolved WASAPI device id string.
    pub fn open_with_id(device_id: String, negotiated: NegotiatedFormat) -> AudioResult<Self> {
        ensure_com()?;
        Ok(Self {
            device_id,
            negotiated,
            running: Arc::new(AtomicBool::new(false)),
            paused: Arc::new(AtomicBool::new(false)),
            underrun_count: Arc::new(AtomicU64::new(0)),
            underrun_frames: Arc::new(AtomicU64::new(0)),
            stop_event: None,
            thread: None,
            on_error: None,
        })
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn set_error_callback(&mut self, cb: Option<DeviceErrorCallback>) {
        self.on_error = cb;
    }

    pub fn negotiated_format(&self) -> &NegotiatedFormat {
        &self.negotiated
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Acquire)
    }

    /// Attach the ring consumer and start the exclusive render thread.
    ///
    /// `pending_reset` mirrors the old CPAL realtime callback: when set, the
    /// render loop drains the consumer so seek/stop can resume cleanly.
    /// Optional `pipeline` drives position / transition / underrun atomics.
    pub fn start(
        &mut self,
        consumer: PcmRingConsumer,
        pending_reset: Arc<AtomicBool>,
        pipeline: Option<Arc<AudioPipeline>>,
    ) -> AudioResult<()> {
        if self.is_running() {
            return Err(AudioError::Playback(
                "WASAPI exclusive output is already running".into(),
            ));
        }

        ensure_com()?;

        let stop_event = unsafe {
            CreateEventW(None, true, false, None).map_err(|e| {
                AudioError::StreamInitialization(format!("CreateEventW(stop) failed: {e}"))
            })?
        };
        let stop = SendHandle::from_handle(stop_event);

        self.paused.store(false, Ordering::Release);
        self.running.store(true, Ordering::Release);
        self.stop_event = Some(stop);

        let device_id = self.device_id.clone();
        let negotiated = self.negotiated.clone();
        let running = Arc::clone(&self.running);
        let paused = Arc::clone(&self.paused);
        let underrun_count = Arc::clone(&self.underrun_count);
        let underrun_frames = Arc::clone(&self.underrun_frames);
        let on_error = self.on_error.clone();
        let (ready_tx, ready_rx) = bounded::<AudioResult<()>>(1);

        let thread = thread::Builder::new()
            .name("wasapi-exclusive".into())
            .spawn(move || {
                let result = render_thread_main(
                    device_id,
                    negotiated,
                    consumer,
                    stop,
                    running.clone(),
                    paused,
                    underrun_count,
                    underrun_frames,
                    pending_reset,
                    pipeline,
                    ready_tx,
                );
                running.store(false, Ordering::Release);
                if let Err(err) = result {
                    if let Some(cb) = on_error {
                        cb(err);
                    }
                }
            })
            .map_err(|e| {
                self.running.store(false, Ordering::Release);
                unsafe {
                    let _ = CloseHandle(stop.as_handle());
                }
                self.stop_event = None;
                AudioError::StreamInitialization(format!(
                    "failed to spawn WASAPI render thread: {e}"
                ))
            })?;

        // Block until Initialize + Start succeed (or fail). Exclusive is only
        // considered active after this handshake — never report success early.
        match ready_rx.recv() {
            Ok(Ok(())) => {
                self.thread = Some(thread);
                tracing::info!(
                    target: "wasapi",
                    endpoint = %self.device_id,
                    wave = %self.negotiated.wave,
                    rate = self.negotiated.format.sample_rate,
                    "WASAPI Exclusive output started (AUDCLNT_SHAREMODE_EXCLUSIVE)"
                );
                Ok(())
            }
            Ok(Err(err)) => {
                self.running.store(false, Ordering::Release);
                let _ = thread.join();
                if let Some(stop) = self.stop_event.take() {
                    unsafe {
                        let _ = CloseHandle(stop.as_handle());
                    }
                }
                Err(err)
            }
            Err(_) => {
                self.running.store(false, Ordering::Release);
                let _ = thread.join();
                if let Some(stop) = self.stop_event.take() {
                    unsafe {
                        let _ = CloseHandle(stop.as_handle());
                    }
                }
                Err(AudioError::StreamInitialization(
                    "WASAPI exclusive render thread exited before Initialize completed".into(),
                ))
            }
        }
    }

    /// Soft pause: render thread writes silence (stream stays open / exclusive).
    pub fn pause(&mut self) {
        self.paused.store(true, Ordering::Release);
    }

    pub fn resume(&mut self) {
        self.paused.store(false, Ordering::Release);
    }

    /// Signal stop, join the render thread, and release the stop event.
    pub fn stop(&mut self) -> AudioResult<()> {
        self.paused.store(false, Ordering::Release);
        self.running.store(false, Ordering::Release);

        if let Some(stop) = self.stop_event {
            unsafe {
                let _ = SetEvent(stop.as_handle());
            }
        }

        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }

        if let Some(stop) = self.stop_event.take() {
            unsafe {
                let _ = CloseHandle(stop.as_handle());
            }
        }

        Ok(())
    }

    /// Stop, replace the negotiated format, ready for a new [`Self::start`].
    pub fn reinitialize(&mut self, format: NegotiatedFormat) -> AudioResult<()> {
        self.stop()?;
        self.negotiated = format;
        self.underrun_count.store(0, Ordering::Relaxed);
        self.underrun_frames.store(0, Ordering::Relaxed);
        Ok(())
    }
}

impl Drop for WasapiExclusiveOutput {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[allow(clippy::too_many_arguments)]
fn render_thread_main(
    device_id: String,
    negotiated: NegotiatedFormat,
    mut consumer: PcmRingConsumer,
    stop: SendHandle,
    running: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    underrun_count: Arc<AtomicU64>,
    underrun_frames: Arc<AtomicU64>,
    pending_reset: Arc<AtomicBool>,
    pipeline: Option<Arc<AudioPipeline>>,
    ready_tx: Sender<AudioResult<()>>,
) -> AudioResult<()> {
    let _com_guard = ensure_com_guard()?;

    let notify_ready = |result: AudioResult<()>| {
        let _ = ready_tx.send(result);
    };

    let device = match open_device_by_id(&device_id) {
        Ok(d) => d,
        Err(e) => {
            let msg = e.to_string();
            notify_ready(Err(AudioError::DeviceUnavailable(msg.clone())));
            return Err(AudioError::DeviceUnavailable(msg));
        }
    };

    tracing::info!(
        target: "wasapi",
        endpoint = %device_id,
        wave = %negotiated.wave,
        share_mode = "AUDCLNT_SHAREMODE_EXCLUSIVE",
        "opening exclusive render client"
    );

    let bytes_per_frame = negotiated.bytes_per_frame().max(1);
    let format_ptr = negotiated.wave.as_wave_format_ex();

    let (client, buffer_frames, period) = match activate_and_init_exclusive(&device, format_ptr) {
        Ok(v) => v,
        Err(e) => {
            let msg = e.to_string();
            notify_ready(Err(AudioError::StreamInitialization(msg.clone())));
            return Err(AudioError::StreamInitialization(msg));
        }
    };

    if let Err(err) = negotiated
        .wave
        .validate_pcm_layout(negotiated.container_bytes_per_sample)
    {
        tracing::error!(
            target: "wasapi",
            error = %err,
            wave = %negotiated.wave,
            "WAVEFORMATEX layout invariant failed at Initialize"
        );
        debug_assert!(false, "WAVEFORMATEX layout at Initialize: {err}");
    }

    if let Some(p) = pipeline.as_ref() {
        p.set_render_wire(negotiated.wave.describe(), buffer_frames, period);
        let expected_bpf = negotiated.bytes_per_frame();
        if bytes_per_frame != expected_bpf {
            tracing::error!(
                target: "wasapi",
                bytes_per_frame,
                expected_bpf,
                "stale bytes_per_frame vs negotiated wire"
            );
            debug_assert_eq!(bytes_per_frame, expected_bpf);
        }
    }

    let buffer_event = unsafe {
        match CreateEventW(None, false, false, None) {
            Ok(h) => h,
            Err(e) => {
                let err =
                    AudioError::StreamInitialization(format!("CreateEventW(buffer) failed: {e}"));
                let msg = err.to_string();
                notify_ready(Err(AudioError::StreamInitialization(msg)));
                return Err(err);
            }
        }
    };
    let buffer_event = SendHandle::from_handle(buffer_event);

    unsafe {
        if let Err(e) = client.SetEventHandle(buffer_event.as_handle()) {
            let _ = CloseHandle(buffer_event.as_handle());
            let err = AudioError::StreamInitialization(format!("SetEventHandle failed: {e}"));
            notify_ready(Err(AudioError::StreamInitialization(err.to_string())));
            return Err(err);
        }
    }

    let render: IAudioRenderClient = unsafe {
        match client.GetService() {
            Ok(r) => r,
            Err(e) => {
                let _ = CloseHandle(buffer_event.as_handle());
                let code = e.code().0 as u32;
                let err = AudioError::StreamInitialization(format!(
                    "GetService(IAudioRenderClient) failed: {e} (HRESULT 0x{code:08X})"
                ));
                notify_ready(Err(AudioError::StreamInitialization(err.to_string())));
                return Err(err);
            }
        }
    };

    if let Err(e) = fill_period(
        &client,
        &render,
        &mut consumer,
        buffer_frames,
        bytes_per_frame,
        &paused,
        &underrun_count,
        &underrun_frames,
        &pending_reset,
        pipeline.as_deref(),
        false,
    ) {
        unsafe {
            let _ = CloseHandle(buffer_event.as_handle());
        }
        notify_ready(Err(AudioError::StreamError(e.to_string())));
        return Err(e);
    }

    unsafe {
        if let Err(e) = client.Start() {
            let _ = CloseHandle(buffer_event.as_handle());
            let code = e.code().0 as u32;
            let err = AudioError::StreamInitialization(format!(
                "IAudioClient::Start failed: {e} (HRESULT 0x{code:08X})"
            ));
            notify_ready(Err(AudioError::StreamInitialization(err.to_string())));
            return Err(err);
        }
    }

    tracing::info!(
        target: "wasapi",
        endpoint = %device_id,
        buffer_frames,
        "IAudioClient::Start OK — exclusive output mode active"
    );
    notify_ready(Ok(()));

    let mut result = Ok(());
    while running.load(Ordering::Acquire) {
        let wait = unsafe {
            WaitForMultipleObjects(&[stop.as_handle(), buffer_event.as_handle()], false, 2_000)
        };

        if wait == WAIT_OBJECT_0 {
            break;
        }
        if wait == WAIT_TIMEOUT {
            continue;
        }
        if wait.0 != WAIT_OBJECT_0.0 + 1 {
            result = Err(AudioError::StreamError(format!(
                "WaitForMultipleObjects returned {}",
                wait.0
            )));
            break;
        }

        if let Err(e) = fill_period(
            &client,
            &render,
            &mut consumer,
            buffer_frames,
            bytes_per_frame,
            &paused,
            &underrun_count,
            &underrun_frames,
            &pending_reset,
            pipeline.as_deref(),
            false,
        ) {
            result = Err(e);
            break;
        }
    }

    unsafe {
        let _ = client.Stop();
        let _ = CloseHandle(buffer_event.as_handle());
    }

    drop(render);
    drop(client);
    drop(device);

    result
}

fn open_device_by_id(device_id: &str) -> AudioResult<IMMDevice> {
    let enumerator: IMMDeviceEnumerator = unsafe {
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| {
            AudioError::DeviceUnavailable(format!("MMDeviceEnumerator create failed: {e}"))
        })?
    };

    if device_id.is_empty() {
        return unsafe {
            enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| AudioError::DeviceUnavailable(format!("default render endpoint: {e}")))
        };
    }

    let wide: Vec<u16> = OsStr::new(device_id)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        enumerator.GetDevice(PCWSTR(wide.as_ptr())).map_err(|e| {
            AudioError::DeviceUnavailable(format!("GetDevice({device_id}) failed: {e}"))
        })
    }
}

fn activate_and_init_exclusive(
    device: &IMMDevice,
    format: *const WAVEFORMATEX,
) -> AudioResult<(IAudioClient, u32, i64)> {
    let client: IAudioClient = unsafe {
        device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| AudioError::StreamInitialization(format!("Activate IAudioClient: {e}")))?
    };

    let mut period = 0i64;
    unsafe {
        client
            .GetDevicePeriod(None, Some(&mut period))
            .map_err(|e| {
                AudioError::StreamInitialization(format!("GetDevicePeriod failed: {e}"))
            })?;
    }
    if period <= 0 {
        period = 10_000; // 1 ms in 100-ns units
    }

    tracing::info!(
        target: "wasapi",
        period_100ns = period,
        "Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE) with device min period"
    );

    let init = unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            period,
            period,
            format,
            None,
        )
    };

    match init {
        Ok(()) => {
            let frames = unsafe {
                client.GetBufferSize().map_err(|e| {
                    AudioError::StreamInitialization(format!("GetBufferSize failed: {e}"))
                })?
            };
            tracing::info!(
                target: "wasapi",
                buffer_frames = frames,
                "exclusive Initialize succeeded"
            );
            Ok((client, frames, period))
        }
        Err(e) if e.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED => {
            let frames = unsafe {
                client.GetBufferSize().map_err(|err| {
                    AudioError::StreamInitialization(format!(
                        "GetBufferSize after align error: {err}"
                    ))
                })?
            };
            drop(client);

            let wfx = unsafe { std::ptr::read_unaligned(format) };
            let rate = wfx.nSamplesPerSec.max(1);
            let aligned = (i64::from(frames) * 10_000_000) / i64::from(rate);

            let client: IAudioClient = unsafe {
                device.Activate(CLSCTX_ALL, None).map_err(|err| {
                    AudioError::StreamInitialization(format!(
                        "re-Activate IAudioClient after align: {err}"
                    ))
                })?
            };
            unsafe {
                client
                    .Initialize(
                        AUDCLNT_SHAREMODE_EXCLUSIVE,
                        AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                        aligned,
                        aligned,
                        format,
                        None,
                    )
                    .map_err(|err| {
                        let code = err.code().0 as u32;
                        AudioError::StreamInitialization(format!(
                            "exclusive Initialize (aligned) failed: {err} (HRESULT 0x{code:08X})"
                        ))
                    })?;
            }
            let frames = unsafe {
                client.GetBufferSize().map_err(|err| {
                    AudioError::StreamInitialization(format!(
                        "GetBufferSize (aligned) failed: {err}"
                    ))
                })?
            };
            tracing::info!(
                target: "wasapi",
                buffer_frames = frames,
                aligned_period = aligned,
                "exclusive Initialize (aligned) succeeded"
            );
            Ok((client, frames, aligned))
        }
        Err(e) => {
            let code = e.code().0 as u32;
            if e.code() == AUDCLNT_E_DEVICE_IN_USE {
                return Err(AudioError::DeviceUnavailable(format!(
                    "Exclusive Initialize failed: endpoint in use (HRESULT 0x{code:08X})"
                )));
            }
            if e.code() == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED {
                return Err(AudioError::StreamInitialization(format!(
                    "Exclusive Initialize failed: exclusive mode not allowed (HRESULT 0x{code:08X})"
                )));
            }
            Err(AudioError::StreamInitialization(format!(
                "exclusive Initialize failed: {e} (HRESULT 0x{code:08X})"
            )))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn fill_period(
    _client: &IAudioClient,
    render: &IAudioRenderClient,
    consumer: &mut PcmRingConsumer,
    buffer_frames: u32,
    bytes_per_frame: usize,
    paused: &AtomicBool,
    underrun_count: &AtomicU64,
    underrun_frames: &AtomicU64,
    pending_reset: &AtomicBool,
    pipeline: Option<&AudioPipeline>,
    force_silence: bool,
) -> AudioResult<()> {
    // Event-driven Exclusive uses two endpoint buffers in ping-pong fashion.
    // Each signal hands the client one complete empty buffer, so requesting
    // `buffer_frames - GetCurrentPadding()` (the Shared-mode pattern) can yield
    // zero and leave the driver waiting forever for an unreleased buffer.
    let frames_available = buffer_frames;

    let ptr = unsafe {
        render
            .GetBuffer(frames_available)
            .map_err(map_device_error)?
    };
    if ptr.is_null() {
        return Err(AudioError::StreamError(
            "IAudioRenderClient::GetBuffer returned null".into(),
        ));
    }

    let byte_len = frames_available as usize * bytes_per_frame;
    debug_assert_eq!(
        byte_len % bytes_per_frame.max(1),
        0,
        "GetBuffer length must be a multiple of blockAlign"
    );
    let buf = unsafe { std::slice::from_raw_parts_mut(ptr, byte_len) };

    if pending_reset.load(Ordering::Acquire) {
        consumer.clear();
        pending_reset.store(false, Ordering::Release);
        buf.fill(0);
        unsafe {
            render
                .ReleaseBuffer(frames_available, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)
                .map_err(map_device_error)?;
        }
        return Ok(());
    }

    let pipeline_paused = pipeline
        .map(|p| !p.is_playing.load(Ordering::Relaxed))
        .unwrap_or(false);
    let silence = force_silence || paused.load(Ordering::Acquire) || pipeline_paused;
    let muted = pipeline
        .map(|p| p.is_muted.load(Ordering::Relaxed))
        .unwrap_or(false);
    let mut flags = 0u32;
    let mut frames_written = 0u32;

    if silence {
        buf.fill(0);
        flags = AUDCLNT_BUFFERFLAGS_SILENT.0 as u32;
    } else {
        let got = consumer.pop_bytes(buf);
        let bpf = bytes_per_frame.max(1);
        let aligned = (got / bpf) * bpf;
        if aligned < got {
            static UNALIGNED: AtomicBool = AtomicBool::new(false);
            if !UNALIGNED.swap(true, Ordering::Relaxed) {
                tracing::error!(
                    target: "wasapi",
                    got,
                    aligned,
                    bpf,
                    "PCM ring pop was not frame-aligned; dropping trailing bytes"
                );
            }
        }
        frames_written = (aligned / bpf) as u32;
        if aligned < byte_len {
            buf[aligned..].fill(0);
            let missing_frames = ((byte_len - aligned) / bpf) as u64;
            if missing_frames > 0 {
                underrun_count.fetch_add(1, Ordering::Relaxed);
                underrun_frames.fetch_add(missing_frames, Ordering::Relaxed);
                if let Some(p) = pipeline {
                    p.underrun_count.fetch_add(1, Ordering::Relaxed);
                    p.underrun_samples.fetch_add(
                        missing_frames.saturating_mul(p.channels.load(Ordering::Relaxed) as u64),
                        Ordering::Relaxed,
                    );
                }
            }
            if aligned == 0 {
                flags = AUDCLNT_BUFFERFLAGS_SILENT.0 as u32;
            }
        }
        if muted {
            buf.fill(0);
            flags = AUDCLNT_BUFFERFLAGS_SILENT.0 as u32;
        }
    }

    if let Some(p) = pipeline {
        if frames_written > 0 && !silence {
            let channels = p.channels.load(Ordering::Relaxed) as u64;
            let sample_rate = p.sample_rate.load(Ordering::Relaxed) as u64;
            let interleaved = (frames_written as u64).saturating_mul(channels.max(1));
            let total = p
                .output_samples_total
                .fetch_add(interleaved, Ordering::Relaxed)
                + interleaved;
            let target = p.transition_target_total.load(Ordering::Acquire);
            if target > 0 && total >= target {
                p.transition_ready.store(true, Ordering::Release);
            }
            if channels > 0 && sample_rate > 0 {
                let played =
                    p.samples_played.fetch_add(interleaved, Ordering::Relaxed) + interleaved;
                let frames = played / channels;
                p.position_ms
                    .store(frames.saturating_mul(1000) / sample_rate, Ordering::Relaxed);
            }
        }
    }

    unsafe {
        render
            .ReleaseBuffer(frames_available, flags)
            .map_err(map_device_error)?;
    }
    Ok(())
}

fn map_device_error(err: windows::core::Error) -> AudioError {
    if err.code() == AUDCLNT_E_DEVICE_INVALIDATED {
        AudioError::DeviceUnavailable(format!("WASAPI device invalidated: {err}"))
    } else {
        AudioError::StreamError(format!("WASAPI render error: {err}"))
    }
}
