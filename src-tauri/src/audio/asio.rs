//! Windows ASIO capability and native-DSD playback boundary.
//!
//! The Steinberg SDK itself is kept in `vendor/asio-sdk` and is compiled into
//! a small C ABI bridge. Rust owns the DSD reader, the producer/ring buffer and
//! all player state; the ASIO callback only copies already-buffered bytes into
//! the driver's double buffer.

use crate::audio::dto::{AsioDriverDTO, DsdRate};
use crate::audio::error::{AudioError, AudioResult};

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use crate::audio::asio_bridge_ffi;
    use crate::audio::dop::RawDsdStream;
    use crate::audio::dsd::DsdFormat;
    use crate::audio::pcm_ring::{PcmRing, PcmRingConsumer, PcmRingProducer};
    use std::cell::UnsafeCell;
    use std::ffi::{c_void, CString};
    use std::path::{Path, PathBuf};
    use std::ptr;
    use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use std::time::{Duration, Instant};

    pub const SDK_AVAILABLE: bool = true;

    const ASIOSTDSD_INT8_LSB1: i32 = 32;
    const ASIOSTDSD_INT8_MSB1: i32 = 33;
    const ERROR_CAPACITY: usize = 512;
    const RING_MS: u32 = 2_000;
    /// Registry + COM probing is expensive; reuse results briefly so the Auto
    /// planner and capability queries do not re-probe on every track open.
    const DRIVER_CACHE_TTL: Duration = Duration::from_secs(30);

    fn error_from_text(text: String) -> AudioError {
        AudioError::DeviceUnavailable(format!("ASIO Native DSD: {text}"))
    }

    fn ffi_error(error: &[u8; ERROR_CAPACITY]) -> AudioError {
        let end = error
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(error.len());
        error_from_text(String::from_utf8_lossy(&error[..end]).trim().to_string())
    }

    fn driver_name_for_id(id: Option<&str>, rate: DsdRate) -> AudioResult<String> {
        let drivers = drivers_snapshot();
        let Some(id) = id.filter(|value| !value.trim().is_empty()) else {
            return drivers
                .first()
                .filter(|driver| driver.dsd_rates.contains(&rate))
                .map(|driver| driver.name.clone())
                .or_else(|| {
                    drivers
                        .iter()
                        .find(|driver| driver.dsd_rates.contains(&rate))
                        .map(|driver| driver.name.clone())
                })
                .ok_or_else(|| {
                    error_from_text(format!(
                        "no installed ASIO driver supports {}",
                        rate.label()
                    ))
                });
        };
        drivers
            .into_iter()
            .find(|driver| driver.id.eq_ignore_ascii_case(id))
            .map(|driver| driver.name)
            .ok_or_else(|| error_from_text(format!("selected ASIO driver '{id}' was not found")))
    }

    fn probe_native_driver_hz(name: &str, sample_rate_hz: f64) -> AudioResult<i32> {
        let driver_name = CString::new(name)
            .map_err(|_| error_from_text("ASIO driver name contains an invalid NUL".into()))?;
        let mut sample_type = 0i32;
        let mut error = [0u8; ERROR_CAPACITY];
        let ok = unsafe {
            asio_bridge_ffi::ng_asio_probe_native(
                driver_name.as_ptr(),
                sample_rate_hz,
                &mut sample_type,
                error.as_mut_ptr().cast(),
                error.len() as i32,
            )
        };
        if ok == 0 {
            Err(ffi_error(&error))
        } else if matches!(sample_type, ASIOSTDSD_INT8_LSB1 | ASIOSTDSD_INT8_MSB1) {
            Ok(sample_type)
        } else {
            Err(error_from_text(
                "ASIO returned an unsupported DSD sample type".into(),
            ))
        }
    }

    /// Probe both 44.1 kHz and 48 kHz DSD families for this rate label.
    fn probe_native_driver(name: &str, rate: DsdRate) -> AudioResult<i32> {
        let mut last_error = None;
        for hz in rate.sample_rate_families_hz() {
            match probe_native_driver_hz(name, f64::from(hz)) {
                Ok(sample_type) => return Ok(sample_type),
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error
            .unwrap_or_else(|| error_from_text(format!("ASIO driver rejected {}", rate.label()))))
    }
    /// Probing is deliberately conservative: a driver is advertised as native
    /// DSD only after its own ASIO DSD mode accepts that exact rate.
    pub fn enumerate_drivers() -> Vec<AsioDriverDTO> {
        use std::collections::BTreeMap;
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let mut drivers = BTreeMap::<String, AsioDriverDTO>::new();
        for registry_path in ["SOFTWARE\\ASIO", "SOFTWARE\\WOW6432Node\\ASIO"] {
            let Ok(asio_key) = hklm.open_subkey(registry_path) else {
                continue;
            };
            for key_name in asio_key.enum_keys().flatten() {
                let Ok(driver_key) = asio_key.open_subkey(&key_name) else {
                    continue;
                };
                let description = driver_key
                    .get_value::<String, _>("Description")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| key_name.clone());
                let id = key_name.to_ascii_lowercase();
                let mut dto = AsioDriverDTO {
                    id: id.clone(),
                    name: description.clone(),
                    native_dsd_supported: false,
                    dsd_rates: Vec::new(),
                };
                for rate in [
                    DsdRate::Dsd64,
                    DsdRate::Dsd128,
                    DsdRate::Dsd256,
                    DsdRate::Dsd512,
                ] {
                    if probe_native_driver(&description, rate).is_ok() {
                        dto.dsd_rates.push(rate);
                    }
                }
                dto.native_dsd_supported = !dto.dsd_rates.is_empty();
                drivers.entry(id).or_insert(dto);
            }
        }
        drivers.into_values().collect()
    }

    /// Cached [`enumerate_drivers`] snapshot (TTL [`DRIVER_CACHE_TTL`]).
    pub fn drivers_snapshot() -> Vec<AsioDriverDTO> {
        static CACHE: Mutex<Option<(Instant, Vec<AsioDriverDTO>)>> = Mutex::new(None);
        if let Ok(guard) = CACHE.lock() {
            if let Some((probed_at, drivers)) = guard.as_ref() {
                if probed_at.elapsed() < DRIVER_CACHE_TTL {
                    return drivers.clone();
                }
            }
        }
        let drivers = enumerate_drivers();
        if let Ok(mut guard) = CACHE.lock() {
            *guard = Some((Instant::now(), drivers.clone()));
        }
        drivers
    }

    pub fn open_native_dsd(driver_id: Option<&str>) -> AudioResult<()> {
        let name = driver_name_for_id(driver_id, DsdRate::Dsd64)?;
        probe_native_driver(&name, DsdRate::Dsd64).map(|_| ())
    }

    struct NativeCallbackState {
        consumer: UnsafeCell<PcmRingConsumer>,
        scratch: UnsafeCell<Vec<u8>>,
        channels: usize,
        sample_type: i32,
        playing: Arc<AtomicBool>,
        producer_done: Arc<AtomicBool>,
        finished: Arc<AtomicBool>,
        status_code: Arc<AtomicI32>,
        consumed_channel_bytes: AtomicU64,
        underruns: AtomicU64,
    }

    // The consumer and scratch buffer are touched only by the ASIO callback.
    // Controller operations stop ASIO before clearing/replacing them.
    unsafe impl Send for NativeCallbackState {}
    unsafe impl Sync for NativeCallbackState {}

    impl NativeCallbackState {
        fn new(
            consumer: PcmRingConsumer,
            capacity: usize,
            channels: usize,
            sample_type: i32,
            playing: Arc<AtomicBool>,
            producer_done: Arc<AtomicBool>,
            status_code: Arc<AtomicI32>,
        ) -> Self {
            Self {
                consumer: UnsafeCell::new(consumer),
                scratch: UnsafeCell::new(vec![0x55; capacity]),
                channels,
                sample_type,
                playing,
                producer_done,
                finished: Arc::new(AtomicBool::new(false)),
                status_code,
                consumed_channel_bytes: AtomicU64::new(0),
                underruns: AtomicU64::new(0),
            }
        }

        unsafe fn clear(&self) {
            (*self.consumer.get()).clear();
            self.finished.store(false, Ordering::Release);
            self.status_code.store(0, Ordering::Release);
            self.consumed_channel_bytes.store(0, Ordering::Release);
        }

        unsafe fn replace_consumer(&self, consumer: PcmRingConsumer) {
            *self.consumer.get() = consumer;
            self.finished.store(false, Ordering::Release);
            self.status_code.store(0, Ordering::Release);
            self.consumed_channel_bytes.store(0, Ordering::Release);
        }

        fn set_position_ms(&self, target_ms: u64, dsd_sample_rate: u32) {
            self.consumed_channel_bytes.store(
                target_ms.saturating_mul(u64::from(dsd_sample_rate.max(1))) / 8_000,
                Ordering::Release,
            );
        }

        fn finished(&self) -> bool {
            self.finished.load(Ordering::Acquire)
        }

        fn position_ms(&self, dsd_sample_rate: u32) -> u64 {
            self.consumed_channel_bytes
                .load(Ordering::Acquire)
                .saturating_mul(8_000)
                / u64::from(dsd_sample_rate.max(1))
        }
    }

    unsafe extern "C" fn asio_fill(
        user: *mut c_void,
        channel_buffers: *mut *mut c_void,
        channel_count: i32,
        bytes_per_channel: i32,
    ) {
        if user.is_null()
            || channel_buffers.is_null()
            || channel_count <= 0
            || bytes_per_channel <= 0
        {
            return;
        }
        let state = &*(user.cast::<NativeCallbackState>());
        let channels = state.channels.min(channel_count as usize);
        let bytes = bytes_per_channel as usize;
        let required = bytes.saturating_mul(state.channels);
        let scratch = &mut *state.scratch.get();
        if scratch.len() < required {
            return;
        }

        let playing = state.playing.load(Ordering::Acquire);
        let consumer = &mut *state.consumer.get();
        let read = if playing {
            consumer.pop_bytes(&mut scratch[..required])
        } else {
            0
        };
        if read < required {
            scratch[read..required].fill(0x55);
            if playing && read > 0 {
                state.underruns.fetch_add(1, Ordering::Relaxed);
            }
        }

        for channel in 0..channels {
            let destination = *channel_buffers.add(channel);
            if destination.is_null() {
                continue;
            }
            let destination = std::slice::from_raw_parts_mut(destination.cast::<u8>(), bytes);
            for byte in 0..bytes {
                let source = scratch[byte.saturating_mul(state.channels) + channel];
                destination[byte] = if state.sample_type == ASIOSTDSD_INT8_LSB1 {
                    source.reverse_bits()
                } else {
                    source
                };
            }
        }
        for channel in channels..channel_count as usize {
            let destination = *channel_buffers.add(channel);
            if !destination.is_null() {
                std::slice::from_raw_parts_mut(destination.cast::<u8>(), bytes).fill(0x55);
            }
        }

        if playing {
            let consumed = read / state.channels.max(1);
            state
                .consumed_channel_bytes
                .fetch_add(consumed as u64, Ordering::Relaxed);
            if state.producer_done.load(Ordering::Acquire) && consumer.available() == 0 {
                state.finished.store(true, Ordering::Release);
            }
        }
    }

    unsafe extern "C" fn asio_status(user: *mut c_void, code: i32) {
        if user.is_null() {
            return;
        }
        let state = &*(user.cast::<NativeCallbackState>());
        // A reset/resync/overload is terminal for the current native stream.
        // The decode loop observes `finished` and reports an explicit error;
        // it never switches this stream to PCM automatically.
        if code != 0 {
            state.status_code.store(code, Ordering::Release);
            state.finished.store(true, Ordering::Release);
        }
    }

    struct Producer {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    impl Producer {
        fn spawn(
            mut stream: RawDsdStream,
            mut producer: PcmRingProducer,
            done: Arc<AtomicBool>,
            status_code: Arc<AtomicI32>,
        ) -> Self {
            let stop = Arc::new(AtomicBool::new(false));
            let stop_thread = Arc::clone(&stop);
            let done_thread = Arc::clone(&done);
            let thread = thread::Builder::new()
                .name("asio-dsd-producer".into())
                .spawn(move || {
                    while !stop_thread.load(Ordering::Acquire) {
                        if producer.available() < 1024 {
                            thread::sleep(Duration::from_millis(2));
                            continue;
                        }
                        match stream.next_bytes() {
                            Ok(Some(bytes)) => {
                                let mut offset = 0;
                                while offset < bytes.len()
                                    && !stop_thread.load(Ordering::Acquire)
                                {
                                    let written = producer.push_bytes(&bytes[offset..]);
                                    offset += written;
                                    if written == 0 {
                                        thread::sleep(Duration::from_millis(2));
                                    }
                                }
                            }
                            Ok(None) => break,
                            Err(error) => {
                                tracing::error!(target: "asio", error = %error, "native DSD producer stopped");
                                status_code.store(100, Ordering::Release);
                                break;
                            }
                        }
                    }
                    done_thread.store(true, Ordering::Release);
                })
                .ok();
            Self { stop, thread }
        }

        fn stop(&mut self) {
            self.stop.store(true, Ordering::Release);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    impl Drop for Producer {
        fn drop(&mut self) {
            self.stop();
        }
    }

    pub struct NativeDsdSession {
        handle: *mut c_void,
        callback: Box<NativeCallbackState>,
        callback_playing: Arc<AtomicBool>,
        source_path: PathBuf,
        format: DsdFormat,
        producer: Producer,
        producer_done: Arc<AtomicBool>,
        status_code: Arc<AtomicI32>,
        control: crate::audio::control::AudioControlHandle,
        started: bool,
    }

    unsafe impl Send for NativeDsdSession {}

    impl NativeDsdSession {
        pub fn open(
            path: &Path,
            driver_id: Option<&str>,
            playing: Arc<AtomicBool>,
            control: crate::audio::control::AudioControlHandle,
        ) -> AudioResult<Self> {
            let (format, stream) = RawDsdStream::open(path)?;
            control.disable_for_asio()?;
            let bytes_per_second = usize::try_from(format.dsd_sample_rate / 8)
                .unwrap_or(1)
                .saturating_mul(usize::from(format.channels));
            let capacity = bytes_per_second
                .saturating_mul(RING_MS as usize)
                .saturating_div(1_000)
                .max(64 * 1024);
            let (producer, consumer) = PcmRing::new(capacity).split();
            let producer_done = Arc::new(AtomicBool::new(false));
            let status_code = Arc::new(AtomicI32::new(0));
            let driver_name = driver_name_for_id(driver_id, format.dsd_rate)?;
            let driver_sample_type =
                probe_native_driver_hz(&driver_name, f64::from(format.dsd_sample_rate))?;
            let callback = Box::new(NativeCallbackState::new(
                consumer,
                usize::from(format.channels).saturating_mul(256 * 1024),
                usize::from(format.channels),
                driver_sample_type,
                Arc::clone(&playing),
                Arc::clone(&producer_done),
                Arc::clone(&status_code),
            ));
            let driver_name = CString::new(driver_name)
                .map_err(|_| error_from_text("ASIO driver name contains an invalid NUL".into()))?;
            let mut info = asio_bridge_ffi::NgAsioInfo::default();
            let mut error = [0u8; ERROR_CAPACITY];
            let handle = unsafe {
                asio_bridge_ffi::ng_asio_open_native(
                    driver_name.as_ptr(),
                    f64::from(format.dsd_sample_rate),
                    i32::from(format.channels),
                    Some(asio_fill),
                    Some(asio_status),
                    (&*callback as *const NativeCallbackState).cast_mut().cast(),
                    &mut info,
                    error.as_mut_ptr().cast(),
                    error.len() as i32,
                )
            };
            if handle.is_null() {
                let _ = control.restore_after_asio();
                return Err(ffi_error(&error));
            }
            let mut session = Self {
                handle,
                callback,
                callback_playing: playing,
                source_path: path.to_path_buf(),
                format,
                producer: Producer::spawn(
                    stream,
                    producer,
                    Arc::clone(&producer_done),
                    Arc::clone(&status_code),
                ),
                producer_done,
                status_code,
                control,
                started: false,
            };
            let mut error = [0u8; ERROR_CAPACITY];
            let started = unsafe {
                asio_bridge_ffi::ng_asio_start(
                    session.handle,
                    error.as_mut_ptr().cast(),
                    error.len() as i32,
                )
            };
            if started == 0 {
                session.close_asio();
                session.producer.stop();
                let _ = session.control.restore_after_asio();
                return Err(ffi_error(&error));
            }
            session.started = true;
            Ok(session)
        }

        pub fn format(&self) -> &DsdFormat {
            &self.format
        }

        pub fn is_finished(&self) -> bool {
            self.callback.finished()
        }

        pub fn failure_reason(&self) -> Option<String> {
            match self.callback.status_code.load(Ordering::Acquire) {
                0 => None,
                1 => Some("ASIO driver requested a reset".into()),
                2 => Some("ASIO driver lost synchronization".into()),
                3 => Some("ASIO driver reported an output overload".into()),
                4 => Some("ASIO device changed its sample rate".into()),
                100 => Some("native DSD producer failed while reading the file".into()),
                code => Some(format!("ASIO native DSD stream failed (code {code})")),
            }
        }

        pub fn position_ms(&self) -> u64 {
            self.callback.position_ms(self.format.dsd_sample_rate)
        }

        /// Native seek is implemented by stopping the ASIO stream, rebuilding
        /// the producer from the nearest DSD/DST frame and starting again.
        pub fn seek(&mut self, target_ms: u64) -> AudioResult<u64> {
            self.stop_asio()?;
            self.producer.stop();
            unsafe { self.callback.clear() };
            let (format, mut stream) = RawDsdStream::open(&self.source_path)?;
            stream.seek_ms(target_ms);
            debug_assert_eq!(format.channels, self.format.channels);
            debug_assert_eq!(format.dsd_sample_rate, self.format.dsd_sample_rate);
            let (producer, consumer) = PcmRing::new(
                usize::try_from(format.dsd_sample_rate / 8)
                    .unwrap_or(1)
                    .saturating_mul(usize::from(format.channels))
                    .saturating_mul(RING_MS as usize)
                    .saturating_div(1_000),
            )
            .split();
            unsafe { self.callback.replace_consumer(consumer) };
            self.callback.set_position_ms(
                target_ms.min(self.format.duration_ms),
                self.format.dsd_sample_rate,
            );
            self.producer_done.store(false, Ordering::Release);
            self.producer = Producer::spawn(
                stream,
                producer,
                Arc::clone(&self.producer_done),
                Arc::clone(&self.status_code),
            );
            let mut error = [0u8; ERROR_CAPACITY];
            let started = unsafe {
                asio_bridge_ffi::ng_asio_start(
                    self.handle,
                    error.as_mut_ptr().cast(),
                    error.len() as i32,
                )
            };
            if started == 0 {
                return Err(ffi_error(&error));
            }
            self.started = true;
            Ok(target_ms.min(self.format.duration_ms))
        }

        pub fn set_playing(&self, playing: bool) {
            self.callback_playing.store(playing, Ordering::Release);
        }

        fn stop_asio(&mut self) -> AudioResult<()> {
            if !self.started {
                return Ok(());
            }
            let mut error = [0u8; ERROR_CAPACITY];
            let stopped = unsafe {
                asio_bridge_ffi::ng_asio_stop(
                    self.handle,
                    error.as_mut_ptr().cast(),
                    error.len() as i32,
                )
            };
            if stopped == 0 {
                return Err(ffi_error(&error));
            }
            self.started = false;
            Ok(())
        }

        fn close_asio(&mut self) {
            if !self.handle.is_null() {
                unsafe { asio_bridge_ffi::ng_asio_close(self.handle) };
                self.handle = ptr::null_mut();
            }
            self.started = false;
        }
    }

    impl Drop for NativeDsdSession {
        fn drop(&mut self) {
            self.callback_playing.store(false, Ordering::Release);
            let _ = self.stop_asio();
            self.close_asio();
            self.producer.stop();
            let _ = self.control.restore_after_asio();
        }
    }

    pub fn unavailable_error() -> AudioError {
        error_from_text("ASIO Native DSD is unavailable".into())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn mock_callback_preserves_channels_and_adapts_lsb_bit_order() {
            let (mut producer, consumer) = PcmRing::new(32).split();
            producer.push_bytes(&[0x80, 0x01, 0x40, 0x02]);
            let playing = Arc::new(AtomicBool::new(true));
            let done = Arc::new(AtomicBool::new(false));
            let status = Arc::new(AtomicI32::new(0));
            let state = Box::new(NativeCallbackState::new(
                consumer,
                32,
                2,
                ASIOSTDSD_INT8_LSB1,
                Arc::clone(&playing),
                Arc::clone(&done),
                Arc::clone(&status),
            ));
            let mut left = [0u8; 2];
            let mut right = [0u8; 2];
            let mut buffers = [
                left.as_mut_ptr().cast::<c_void>(),
                right.as_mut_ptr().cast::<c_void>(),
            ];
            unsafe {
                asio_fill(
                    (&*state as *const NativeCallbackState).cast_mut().cast(),
                    buffers.as_mut_ptr(),
                    2,
                    2,
                );
            }
            assert_eq!(left, [0x01, 0x02]);
            assert_eq!(right, [0x80, 0x40]);
            assert_eq!(state.position_ms(2_822_400), 0);
            assert_eq!(status.load(Ordering::Acquire), 0);
        }

        #[test]
        fn mock_callback_status_is_terminal_and_explicit() {
            let (_producer, consumer) = PcmRing::new(32).split();
            let state = Box::new(NativeCallbackState::new(
                consumer,
                32,
                2,
                ASIOSTDSD_INT8_MSB1,
                Arc::new(AtomicBool::new(true)),
                Arc::new(AtomicBool::new(false)),
                Arc::new(AtomicI32::new(0)),
            ));
            unsafe {
                asio_status((&*state as *const NativeCallbackState).cast_mut().cast(), 3);
            }
            assert!(state.finished());
            assert_eq!(state.status_code.load(Ordering::Acquire), 3);
        }
    }
}

#[cfg(windows)]
pub use windows_impl::{
    drivers_snapshot, enumerate_drivers, open_native_dsd, unavailable_error, NativeDsdSession,
    SDK_AVAILABLE,
};

#[cfg(not(windows))]
pub const SDK_AVAILABLE: bool = false;

#[cfg(not(windows))]
pub fn enumerate_drivers() -> Vec<AsioDriverDTO> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn drivers_snapshot() -> Vec<AsioDriverDTO> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn unavailable_error() -> AudioError {
    AudioError::DeviceUnavailable("ASIO Native DSD is only available on Windows".into())
}

#[cfg(not(windows))]
pub fn open_native_dsd(_driver_id: Option<&str>) -> AudioResult<()> {
    Err(unavailable_error())
}
