//! Audio output control plane.
//!
//! Windows defaults to CPAL/WASAPI Shared and opts into WASAPI Exclusive.

#[cfg(windows)]
#[path = "control_wasapi.rs"]
mod exclusive;

#[cfg(windows)]
#[path = "control_cpal.rs"]
mod shared;

#[cfg(not(windows))]
#[path = "control_cpal.rs"]
mod imp;

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use tokio::sync::broadcast;

    use super::{exclusive, shared};
    use crate::audio::dto::{AudioDeviceDTO, AudioEvent};
    use crate::audio::error::{AudioError, AudioResult};
    use crate::audio::pcm::AudioFormat;
    use crate::audio::pipeline::{AudioPipeline, DecodeCommand};
    use crate::audio::wasapi::WasapiDeviceManager;
    use crate::sync_util::recover_mutex;

    pub use exclusive::{source_label_from_format, ConfigureResult};

    #[derive(Clone)]
    pub struct AudioControlHandle {
        shared: shared::AudioControlHandle,
        exclusive: exclusive::AudioControlHandle,
        exclusive_enabled: Arc<AtomicBool>,
        selected_device: Arc<Mutex<Option<String>>>,
    }

    impl AudioControlHandle {
        pub fn spawn(
            pipeline: Arc<AudioPipeline>,
            decode_tx: crossbeam_channel::Sender<DecodeCommand>,
            event_tx: broadcast::Sender<AudioEvent>,
        ) -> Self {
            let shared = shared::AudioControlHandle::spawn(
                Arc::clone(&pipeline),
                decode_tx.clone(),
                event_tx.clone(),
            );
            let exclusive = exclusive::AudioControlHandle::spawn(pipeline, decode_tx, event_tx);
            Self {
                shared,
                exclusive,
                exclusive_enabled: Arc::new(AtomicBool::new(false)),
                selected_device: Arc::new(Mutex::new(None)),
            }
        }

        /// Enable Exclusive only after Shared is dropped and Exclusive Initialize succeeds.
        /// On failure Shared is restored and the exclusive flag stays off.
        pub fn set_exclusive_mode(
            &self,
            enabled: bool,
            source: AudioFormat,
        ) -> AudioResult<Option<ConfigureResult>> {
            if enabled {
                // Never run Shared and Exclusive together.
                self.shared.set_enabled(false)?;
                if self.shared.is_active() {
                    let _ = self.shared.set_enabled(true);
                    return Err(AudioError::Playback(
                        "Failed to stop Shared stream before Exclusive open".into(),
                    ));
                }

                match self.exclusive.configure_exclusive(source, false) {
                    Ok(cfg) => {
                        if self.shared.is_active() {
                            let _ = self.exclusive.disable();
                            let _ = self.shared.set_enabled(true);
                            self.exclusive_enabled.store(false, Ordering::SeqCst);
                            return Err(AudioError::Playback(
                                "Refusing Exclusive: Shared stream was still active".into(),
                            ));
                        }
                        self.exclusive_enabled.store(true, Ordering::SeqCst);
                        tracing::info!(
                            target: "wasapi",
                            endpoint = %cfg.device.id,
                            output_mode = "WASAPI Exclusive",
                            "exclusive mode enabled"
                        );
                        Ok(Some(cfg))
                    }
                    Err(err) => {
                        let _ = self.exclusive.disable();
                        let _ = self.shared.set_enabled(true);
                        self.exclusive_enabled.store(false, Ordering::SeqCst);
                        tracing::warn!(
                            target: "wasapi",
                            error = %err,
                            "exclusive mode enable failed; Shared restored"
                        );
                        Err(err)
                    }
                }
            } else {
                self.exclusive.disable()?;
                self.exclusive_enabled.store(false, Ordering::SeqCst);
                self.shared.set_enabled(true)?;
                let _ = self.shared.ensure_stream();
                tracing::info!(
                    target: "wasapi",
                    output_mode = "WASAPI Shared",
                    "exclusive mode disabled; Shared restored"
                );
                Ok(None)
            }
        }

        /// Enable Exclusive if needed, then configure it for `source` in one
        /// call. Lets per-track fallback plans (Auto/HighQuality) switch from
        /// Shared to Exclusive without a separate mode toggle; on failure the
        /// Shared plane is restored and the exclusive flag stays off.
        pub fn enable_exclusive_for(
            &self,
            source: AudioFormat,
            bit_perfect: bool,
        ) -> AudioResult<ConfigureResult> {
            if self.exclusive_enabled.load(Ordering::SeqCst) {
                return self.configure_exclusive(source, bit_perfect);
            }
            self.shared.set_enabled(false)?;
            if self.shared.is_active() {
                let _ = self.shared.set_enabled(true);
                return Err(AudioError::Playback(
                    "Failed to stop Shared stream before Exclusive open".into(),
                ));
            }
            match self.exclusive.configure_exclusive(source, bit_perfect) {
                Ok(cfg) => {
                    self.exclusive_enabled.store(true, Ordering::SeqCst);
                    tracing::info!(
                        target: "wasapi",
                        endpoint = %cfg.device.id,
                        bit_perfect,
                        "exclusive mode enabled for track"
                    );
                    Ok(cfg)
                }
                Err(err) => {
                    let _ = self.exclusive.disable();
                    let _ = self.shared.set_enabled(true);
                    self.exclusive_enabled.store(false, Ordering::SeqCst);
                    Err(err)
                }
            }
        }

        pub fn exclusive_enabled(&self) -> bool {
            self.exclusive_enabled.load(Ordering::SeqCst)
        }

        pub fn configure_exclusive(
            &self,
            source: AudioFormat,
            bit_perfect: bool,
        ) -> AudioResult<ConfigureResult> {
            if !self.exclusive_enabled.load(Ordering::SeqCst) {
                return Err(AudioError::Playback(
                    "WASAPI Exclusive is not enabled".into(),
                ));
            }
            // Ensure Shared stays down for the duration of Exclusive I/O.
            if self.shared.is_active() {
                self.shared.set_enabled(false)?;
            }
            self.exclusive.configure_exclusive(source, bit_perfect)
        }

        pub fn ensure_stream(&self) -> AudioResult<()> {
            if self.exclusive_enabled.load(Ordering::SeqCst) {
                Ok(())
            } else {
                self.shared.ensure_stream()
            }
        }

        /// Stop every WASAPI stream before ASIO is opened. ASIO drivers often
        /// claim the endpoint exclusively, so merely pausing the WASAPI path
        /// is not sufficient.
        pub fn disable_for_asio(&self) -> AudioResult<()> {
            self.shared.set_enabled(false)?;
            if self.shared.is_active() {
                let _ = self.shared.set_enabled(true);
                return Err(AudioError::Playback(
                    "Failed to stop WASAPI Shared before ASIO open".into(),
                ));
            }
            if self.exclusive_enabled.load(Ordering::SeqCst) {
                self.exclusive.disable()?;
                self.exclusive_enabled.store(false, Ordering::SeqCst);
            }
            if self.exclusive.is_active() {
                let _ = self.shared.set_enabled(true);
                return Err(AudioError::Playback(
                    "Failed to stop WASAPI Exclusive before ASIO open".into(),
                ));
            }
            Ok(())
        }

        /// Restore the normal Shared plane after an ASIO session closes.
        pub fn restore_after_asio(&self) -> AudioResult<()> {
            self.shared.set_enabled(true)?;
            self.shared.ensure_stream()
        }

        pub fn enumerate_devices(&self) -> AudioResult<Vec<AudioDeviceDTO>> {
            // Prefer WASAPI endpoint IDs as the stable device identity.
            self.exclusive.enumerate_devices()
        }

        pub fn selected_device_id(&self) -> Option<String> {
            recover_mutex(&self.selected_device).clone()
        }

        pub fn endpoint_audio_state(&self) -> AudioResult<(f32, bool)> {
            self.exclusive.endpoint_audio_state()
        }

        pub fn set_endpoint_volume(&self, volume: f32) -> AudioResult<()> {
            self.exclusive.set_endpoint_volume(volume)
        }

        pub fn set_endpoint_muted(&self, muted: bool) -> AudioResult<()> {
            self.exclusive.set_endpoint_muted(muted)
        }

        pub fn select_device(&self, device: Option<String>) -> AudioResult<()> {
            let normalized = match device.as_deref() {
                None | Some("") | Some("default") => None,
                Some(id) => Some(id.to_string()),
            };

            let previous = recover_mutex(&self.selected_device).clone();
            if normalized == previous {
                return Ok(());
            }

            tracing::info!(
                target: "audio",
                requested = ?device,
                normalized = ?normalized,
                "selecting output device"
            );

            // Validate / map before committing either plane so a bad id does not
            // leave Exclusive pointing at a missing endpoint.
            let cpal_name = WasapiDeviceManager::cpal_name_for_selection(normalized.as_deref())?;
            let (rollback_device, rollback_cpal) =
                match WasapiDeviceManager::cpal_name_for_selection(previous.as_deref()) {
                    Ok(name) => (previous.clone(), name),
                    Err(error) => {
                        tracing::warn!(
                            target: "audio",
                            previous = ?previous,
                            error = %error,
                            "previous audio device is unavailable; rollback will use system default"
                        );
                        (None, None)
                    }
                };

            self.exclusive.select_device(normalized.clone())?;
            if let Err(error) = self.shared.select_device(cpal_name) {
                let _ = self.exclusive.select_device(rollback_device.clone());
                if let Err(rollback_error) = self.shared.select_device(rollback_cpal.clone()) {
                    tracing::error!(
                        target: "audio",
                        error = %rollback_error,
                        "failed to restore previous Shared device after selection error"
                    );
                }
                return Err(error);
            }

            // If Exclusive mode is on, reopen the exclusive hold stream on the new
            // endpoint immediately so the device is actually switched (not only stored).
            if self.exclusive_enabled.load(Ordering::SeqCst) {
                if let Err(error) = self
                    .exclusive
                    .configure_exclusive(AudioFormat::s16(48_000, 2), false)
                {
                    let _ = self.exclusive.select_device(rollback_device);
                    let _ = self.shared.select_device(rollback_cpal);
                    let _ = self
                        .exclusive
                        .configure_exclusive(AudioFormat::s16(48_000, 2), false);
                    tracing::warn!(
                        target: "wasapi",
                        error = %error,
                        "failed to reopen Exclusive after device change; previous device restored"
                    );
                    return Err(error);
                }
            }
            *recover_mutex(&self.selected_device) = normalized;
            Ok(())
        }

        pub fn set_paused(&self, paused: bool) {
            self.shared.set_paused(paused);
            if self.exclusive_enabled.load(Ordering::SeqCst) {
                self.exclusive.set_paused(paused);
            }
        }

        pub fn exclusive_output_active(&self) -> bool {
            self.exclusive_enabled.load(Ordering::SeqCst) && self.exclusive.is_active()
        }

        pub fn shared_output_active(&self) -> bool {
            !self.exclusive_enabled.load(Ordering::SeqCst) && self.shared.is_active()
        }

        pub fn both_outputs_active(&self) -> bool {
            self.shared.is_active() && self.exclusive.is_active()
        }

        pub fn shutdown(&self) {
            self.shared.shutdown();
            self.exclusive.shutdown();
        }
    }
}

pub use imp::*;
