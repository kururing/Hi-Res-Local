//! Exclusive-mode format probing via `IAudioClient::IsFormatSupported`.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Mutex, OnceLock};

use windows::core::{GUID, HRESULT};
use windows::Win32::Media::Audio::{
    IAudioClient, IMMDevice, AUDCLNT_E_DEVICE_IN_USE, AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED,
    AUDCLNT_E_UNSUPPORTED_FORMAT, AUDCLNT_SHAREMODE_EXCLUSIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
    WAVEFORMATEXTENSIBLE_0, WAVE_FORMAT_PCM,
};
use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;
use windows::Win32::System::Com::{CoTaskMemFree, CLSCTX_ALL};

use crate::audio::error::{AudioError, AudioResult};
use crate::audio::pcm::{AudioFormat, PcmSampleFormat};

type SupportedFormats = (Vec<u32>, Vec<u16>, Vec<u32>);

/// Share mode selected for the negotiated stream (exclusive-only for this stack).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WasapiShareMode {
    Exclusive,
}

/// Result of exclusive format negotiation against a render endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NegotiatedFormat {
    pub format: AudioFormat,
    /// `true` when the device accepted the source format bit-perfectly.
    pub is_native: bool,
    pub share_mode: WasapiShareMode,
    /// Wire container bytes per sample (3 for packed S24, otherwise 2/4).
    pub container_bytes_per_sample: usize,
    /// When true, S24 is packed 3 bytes/sample rather than 24-in-32.
    pub packed_s24: bool,
    /// Exact WAVEFORMATEX / EXTENSIBLE blob that passed `IsFormatSupported`.
    /// Must be passed unchanged to `IAudioClient::Initialize`.
    pub wave: HeldWaveFormat,
}

impl NegotiatedFormat {
    pub fn bytes_per_frame(&self) -> usize {
        self.container_bytes_per_sample
            .saturating_mul(usize::from(self.format.channels.max(1)))
    }
}

const CANDIDATE_RATES: &[u32] = &[
    44_100, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800, 384_000, 705_600, 768_000,
];

/// GUID: `KSDATAFORMAT_SUBTYPE_PCM`
const SUBTYPE_PCM: GUID = GUID::from_u128(0x0000_0001_0000_0010_8000_00aa_0038_9b71);
/// GUID: `KSDATAFORMAT_SUBTYPE_IEEE_FLOAT`
const SUBTYPE_IEEE_FLOAT: GUID = GUID::from_u128(0x0000_0003_0000_0010_8000_00aa_0038_9b71);

const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
const SPEAKER_FRONT_LEFT: u32 = 0x1;
const SPEAKER_FRONT_RIGHT: u32 = 0x2;
const SPEAKER_STEREO: u32 = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;

/// Probes exclusive support and picks a device format.
pub struct FormatNegotiator;

impl FormatNegotiator {
    /// Negotiate an exclusive format for `device`.
    ///
    /// - `bit_perfect == true`: exact match only, else [`AudioError::FormatNotSupported`].
    /// - `bit_perfect == false`: nearest supported exclusive format (`is_native = false`
    ///   when it differs from `source`).
    pub fn negotiate(
        device: &IMMDevice,
        source: &AudioFormat,
        bit_perfect: bool,
    ) -> AudioResult<NegotiatedFormat> {
        let client = activate_client(device)?;
        log_mix_format(&client, source);

        if let Some(exact) = probe_exact(&client, source, bit_perfect)? {
            tracing::info!(
                target: "wasapi",
                rate = exact.format.sample_rate,
                channels = exact.format.channels,
                bit_depth = exact.format.bit_depth,
                packed_s24 = exact.packed_s24,
                wave = %exact.wave,
                "exclusive negotiate: exact match accepted"
            );
            return Ok(NegotiatedFormat {
                format: exact.format,
                is_native: true,
                share_mode: WasapiShareMode::Exclusive,
                container_bytes_per_sample: exact.container_bytes_per_sample,
                packed_s24: exact.packed_s24,
                wave: exact.wave,
            });
        }

        if bit_perfect {
            return Err(AudioError::FormatNotSupported {
                requested: source.describe(),
                details: "DAC rejected exact exclusive format (bit-perfect mode)".into(),
            });
        }

        let channels = normalize_channels(source.channels);
        let mut best: Option<ScoredCandidate> = None;

        for &rate in &ordered_rates(source.sample_rate) {
            for candidate in candidate_encodings(rate, channels, source) {
                if !is_exclusive_supported(&client, &candidate.wave)? {
                    continue;
                }
                let score = score_candidate(source, &candidate);
                let better = match &best {
                    None => true,
                    Some(prev) => score < prev.score,
                };
                if better {
                    best = Some(ScoredCandidate {
                        score,
                        negotiated: NegotiatedFormat {
                            format: candidate.format,
                            is_native: false,
                            share_mode: WasapiShareMode::Exclusive,
                            container_bytes_per_sample: candidate.container_bytes_per_sample,
                            packed_s24: candidate.packed_s24,
                            wave: candidate.wave,
                        },
                    });
                }
            }
        }

        let negotiated =
            best.map(|b| b.negotiated)
                .ok_or_else(|| AudioError::FormatNotSupported {
                    requested: source.describe(),
                    details: "No exclusive PCM/float format accepted by the endpoint".into(),
                })?;

        tracing::info!(
            target: "wasapi",
            rate = negotiated.format.sample_rate,
            channels = negotiated.format.channels,
            bit_depth = negotiated.format.bit_depth,
            packed_s24 = negotiated.packed_s24,
            wave = %negotiated.wave,
            "exclusive negotiate: nearest format accepted"
        );
        Ok(negotiated)
    }

    /// Returns true when the endpoint accepts at least one common exclusive format.
    pub fn exclusive_supported(device: &IMMDevice) -> bool {
        let Ok(client) = activate_client(device) else {
            return false;
        };
        let probe = AudioFormat::s16(48_000, 2);
        for wave in build_wave_candidates(&probe) {
            if is_exclusive_supported(&client, &wave.wave).unwrap_or(false) {
                return true;
            }
        }
        let probe = AudioFormat::s16(44_100, 2);
        for wave in build_wave_candidates(&probe) {
            if is_exclusive_supported(&client, &wave.wave).unwrap_or(false) {
                return true;
            }
        }
        false
    }

    /// Probe which of the common exclusive rates / channel counts the device accepts.
    pub fn probe_supported(device: &IMMDevice) -> AudioResult<(Vec<u32>, Vec<u16>, Vec<u32>)> {
        let client = activate_client(device)?;
        let mut rates = Vec::new();
        let mut channels = Vec::new();
        let mut bit_depths = Vec::new();

        for &ch in &[1u16, 2, 6, 8] {
            for &rate in CANDIDATE_RATES {
                for bits in [16u32, 24, 32] {
                    let fmt = match bits {
                        16 => AudioFormat::s16(rate, ch),
                        24 => AudioFormat::s24_in_32(rate, ch),
                        _ => AudioFormat::s32(rate, ch),
                    };
                    for wave in build_wave_candidates(&fmt) {
                        if is_exclusive_supported(&client, &wave.wave)? {
                            if !rates.contains(&rate) {
                                rates.push(rate);
                            }
                            if !channels.contains(&ch) {
                                channels.push(ch);
                            }
                            if !bit_depths.contains(&bits) {
                                bit_depths.push(bits);
                            }
                            break;
                        }
                    }
                    // Also try float at 32.
                    if bits == 32 {
                        let f = AudioFormat::f32(rate, ch);
                        for wave in build_wave_candidates(&f) {
                            if is_exclusive_supported(&client, &wave.wave)? {
                                if !rates.contains(&rate) {
                                    rates.push(rate);
                                }
                                if !channels.contains(&ch) {
                                    channels.push(ch);
                                }
                                if !bit_depths.contains(&32) {
                                    bit_depths.push(32);
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }

        rates.sort_unstable();
        channels.sort_unstable();
        bit_depths.sort_unstable();
        Ok((rates, channels, bit_depths))
    }

    /// Probe which DSD rates this endpoint may carry as DoP 1.1.
    ///
    /// This is a **wire** check only: Exclusive 24-bit stereo PCM at
    /// `dsd_rate / 16` (both 44.1 kHz and 48 kHz families). It does **not**
    /// prove the DAC decodes DoP markers (`0x05`/`0xFA`). HDMI, Bluetooth,
    /// onboard HD Audio, and known PCM-only names are rejected. All
    /// DSD64/128/256/512 carrier rates are probed. Empty means DoP must not be
    /// offered.
    pub fn probe_dop_rates(device: &IMMDevice) -> Vec<crate::audio::dto::DsdRate> {
        if !dop_device_eligible(device) {
            return Vec::new();
        }
        let Ok(client) = activate_client(device) else {
            return Vec::new();
        };
        crate::audio::dop::advertised_dop_rates(|pcm_rate| exclusive_s24_at(&client, pcm_rate))
    }

    /// True when this DSD bit rate can be offered as DoP on `device`:
    /// eligible endpoint, an advertised DSD rate, and Exclusive 24-bit at the
    /// exact DoP PCM rate (`dsd_sample_rate / 16`).
    pub fn dop_wire_supported(device: &IMMDevice, dsd_sample_rate: u32) -> bool {
        if !dop_device_eligible(device) {
            return false;
        }
        let advertised = Self::probe_dop_rates(device);
        if !crate::audio::dop::dop_sample_rate_is_advertised(dsd_sample_rate, &advertised) {
            return false;
        }
        let Ok(client) = activate_client(device) else {
            return false;
        };
        exclusive_s24_at(&client, crate::audio::dop::dop_pcm_rate(dsd_sample_rate))
    }

    /// Cached [`Self::probe_supported`] keyed by WASAPI endpoint id.
    pub fn probe_supported_cached(
        device: &IMMDevice,
        device_id: &str,
    ) -> AudioResult<(Vec<u32>, Vec<u16>, Vec<u32>)> {
        static CACHE: OnceLock<Mutex<HashMap<String, SupportedFormats>>> = OnceLock::new();
        let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(guard) = cache.lock() {
            if let Some(hit) = guard.get(device_id) {
                return Ok(hit.clone());
            }
        }
        let probed = Self::probe_supported(device)?;
        if let Ok(mut guard) = cache.lock() {
            guard.insert(device_id.to_string(), probed.clone());
        }
        Ok(probed)
    }
}

struct WaveCandidate {
    format: AudioFormat,
    container_bytes_per_sample: usize,
    packed_s24: bool,
    wave: HeldWaveFormat,
}

struct ScoredCandidate {
    score: i64,
    negotiated: NegotiatedFormat,
}

struct ExactMatch {
    format: AudioFormat,
    container_bytes_per_sample: usize,
    packed_s24: bool,
    wave: HeldWaveFormat,
}

/// Owned WAVEFORMATEX / EXTENSIBLE blob for IsFormatSupported / Initialize.
#[derive(Clone, PartialEq, Eq)]
pub struct HeldWaveFormat {
    bytes: Vec<u8>,
}

impl HeldWaveFormat {
    pub fn as_wave_format_ex(&self) -> *const WAVEFORMATEX {
        self.bytes.as_ptr() as *const WAVEFORMATEX
    }

    pub fn describe(&self) -> String {
        if self.bytes.len() < std::mem::size_of::<WAVEFORMATEX>() {
            return format!("invalid WAVEFORMATEX ({} bytes)", self.bytes.len());
        }
        let wfx = unsafe { std::ptr::read_unaligned(self.bytes.as_ptr() as *const WAVEFORMATEX) };
        let tag = wfx.wFormatTag;
        let rate = wfx.nSamplesPerSec;
        let channels = wfx.nChannels;
        let bits = wfx.wBitsPerSample;
        let block = wfx.nBlockAlign;
        let avg = wfx.nAvgBytesPerSec;
        let cb = wfx.cbSize;
        format!("tag=0x{tag:04X} rate={rate} ch={channels} bits={bits} block={block} avg={avg} cbSize={cb}")
    }
}

impl fmt::Debug for HeldWaveFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "HeldWaveFormat({})", self.describe())
    }
}

impl fmt::Display for HeldWaveFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.describe())
    }
}

fn activate_client(device: &IMMDevice) -> AudioResult<IAudioClient> {
    unsafe {
        device
            .Activate::<IAudioClient>(CLSCTX_ALL, None)
            .map_err(|e| {
                AudioError::StreamInitialization(format!("IAudioClient activate failed: {e}"))
            })
    }
}

fn log_mix_format(client: &IAudioClient, requested: &AudioFormat) {
    match unsafe { client.GetMixFormat() } {
        Ok(ptr) if !ptr.is_null() => {
            let mix = unsafe { std::ptr::read_unaligned(ptr) };
            let mix_tag = mix.wFormatTag;
            let mix_rate = mix.nSamplesPerSec;
            let mix_channels = mix.nChannels;
            let mix_bits = mix.wBitsPerSample;
            tracing::info!(
                target: "wasapi",
                mix_tag = format!("0x{mix_tag:04X}"),
                mix_rate,
                mix_channels,
                mix_bits,
                requested = %requested.describe(),
                "WASAPI mix format vs requested source"
            );
            unsafe {
                free_wave_format(ptr);
            }
        }
        Ok(_) => {
            tracing::warn!(target: "wasapi", "GetMixFormat returned null");
        }
        Err(e) => {
            tracing::warn!(
                target: "wasapi",
                error = %e,
                "GetMixFormat failed"
            );
        }
    }
}

fn probe_exact(
    client: &IAudioClient,
    source: &AudioFormat,
    bit_perfect: bool,
) -> AudioResult<Option<ExactMatch>> {
    let channels = if bit_perfect {
        source.channels.max(1)
    } else {
        normalize_channels(source.channels)
    };
    let adjusted = AudioFormat {
        channels,
        ..*source
    };
    for wave in build_wave_candidates(&adjusted) {
        if is_exclusive_supported(client, &wave.wave)? {
            return Ok(Some(ExactMatch {
                format: wave.format,
                container_bytes_per_sample: wave.container_bytes_per_sample,
                packed_s24: wave.packed_s24,
                wave: wave.wave,
            }));
        }
    }
    Ok(None)
}

fn exclusive_s24_at(client: &IAudioClient, pcm_rate: u32) -> bool {
    let fmt = AudioFormat::s24_in_32(pcm_rate, 2);
    build_wave_candidates(&fmt)
        .iter()
        .any(|wave| is_exclusive_supported(client, &wave.wave).unwrap_or(false))
}

fn dop_device_eligible(device: &IMMDevice) -> bool {
    let enumerator = super::device::device_enumerator_name(device).unwrap_or_default();
    let form_factor = super::device::device_form_factor(device).unwrap_or(u32::MAX);
    let name = super::device::device_friendly_name(device).unwrap_or_default();
    crate::audio::dop::dop_endpoint_eligible(&enumerator, form_factor, &name)
}

fn is_exclusive_supported(client: &IAudioClient, wave: &HeldWaveFormat) -> AudioResult<bool> {
    // Exclusive mode: ppClosestMatch must be NULL.
    let hr = unsafe {
        client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, wave.as_wave_format_ex(), None)
    };
    let code = hr.0 as u32;
    if hr.is_ok() {
        tracing::debug!(
            target: "wasapi",
            wave = %wave,
            hr = format!("0x{code:08X}"),
            "IsFormatSupported: accepted"
        );
        return Ok(true);
    }
    if hr == AUDCLNT_E_UNSUPPORTED_FORMAT {
        tracing::debug!(
            target: "wasapi",
            wave = %wave,
            hr = format!("0x{code:08X}"),
            "IsFormatSupported: unsupported"
        );
        return Ok(false);
    }
    if hr == AUDCLNT_E_DEVICE_IN_USE {
        return Err(AudioError::DeviceUnavailable(format!(
            "Audio endpoint is in use by another application (HRESULT 0x{code:08X})"
        )));
    }
    if hr == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED {
        return Err(AudioError::StreamInitialization(format!(
            "Exclusive mode is not allowed on this endpoint (HRESULT 0x{code:08X})"
        )));
    }
    // Some drivers return generic E_FAIL / AUDCLNT errors for unsupported.
    if failed_means_unsupported(hr) {
        tracing::debug!(
            target: "wasapi",
            wave = %wave,
            hr = format!("0x{code:08X}"),
            "IsFormatSupported: treated as unsupported"
        );
        return Ok(false);
    }
    Err(AudioError::StreamInitialization(format!(
        "IsFormatSupported failed: 0x{code:08X}"
    )))
}

fn failed_means_unsupported(hr: HRESULT) -> bool {
    // AUDCLNT_E_* facility and common "not supported" style codes.
    // Exclude device-in-use / exclusive-not-allowed — those are hard failures.
    let code = hr.0 as u32;
    if code == AUDCLNT_E_DEVICE_IN_USE.0 as u32
        || code == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED.0 as u32
    {
        return false;
    }
    code == AUDCLNT_E_UNSUPPORTED_FORMAT.0 as u32 || (code & 0xFFFF_0000) == 0x8889_0000
}

fn normalize_channels(channels: u16) -> u16 {
    match channels {
        0 | 1 => 2, // prefer stereo exclusive endpoints
        c => c,
    }
}

fn ordered_rates(preferred: u32) -> Vec<u32> {
    let mut rates: Vec<u32> = CANDIDATE_RATES.to_vec();
    if !rates.contains(&preferred) && preferred >= 8_000 {
        rates.push(preferred);
    }
    rates.sort_by_key(|r| rate_distance(preferred, *r));
    rates
}

fn rate_distance(a: u32, b: u32) -> u32 {
    a.abs_diff(b)
}

fn candidate_encodings(rate: u32, channels: u16, source: &AudioFormat) -> Vec<WaveCandidate> {
    let mut formats = Vec::new();

    // Prefer encodings close to the source first.
    let mut ordered_bits: Vec<(PcmSampleFormat, u32)> = match source.sample_format {
        PcmSampleFormat::F32 => vec![
            (PcmSampleFormat::F32, 32),
            (PcmSampleFormat::S32, 32),
            (PcmSampleFormat::S24, 24),
            (PcmSampleFormat::S16, 16),
        ],
        PcmSampleFormat::S32 => vec![
            (PcmSampleFormat::S32, 32),
            (PcmSampleFormat::S24, 24),
            (PcmSampleFormat::F32, 32),
            (PcmSampleFormat::S16, 16),
        ],
        PcmSampleFormat::S24 => vec![
            (PcmSampleFormat::S24, 24),
            (PcmSampleFormat::S32, 32),
            (PcmSampleFormat::S16, 16),
            (PcmSampleFormat::F32, 32),
        ],
        PcmSampleFormat::S16 => vec![
            (PcmSampleFormat::S16, 16),
            (PcmSampleFormat::S24, 24),
            (PcmSampleFormat::S32, 32),
            (PcmSampleFormat::F32, 32),
        ],
    };

    // Dedup while preserving order.
    let mut seen = Vec::new();
    ordered_bits.retain(|x| {
        if seen.contains(x) {
            false
        } else {
            seen.push(*x);
            true
        }
    });

    for (sample_format, bit_depth) in ordered_bits {
        let fmt = AudioFormat::new(rate, channels, sample_format, bit_depth);
        formats.extend(build_wave_candidates(&fmt));
    }
    formats
}

fn score_candidate(source: &AudioFormat, candidate: &WaveCandidate) -> i64 {
    let rate_pen = i64::from(source.sample_rate.abs_diff(candidate.format.sample_rate));
    let ch_pen = i64::from(source.channels.abs_diff(candidate.format.channels)) * 10_000;
    let bit_pen = i64::from(source.bit_depth.abs_diff(candidate.format.bit_depth)) * 100;
    let fmt_pen = if source.sample_format == candidate.format.sample_format {
        0
    } else {
        1_000
    };
    // Prefer 24-in-32 over packed when both exist.
    let pack_pen = if candidate.packed_s24 { 50 } else { 0 };
    rate_pen + ch_pen + bit_pen + fmt_pen + pack_pen
}

fn build_wave_candidates(format: &AudioFormat) -> Vec<WaveCandidate> {
    let mut out = Vec::new();
    match format.sample_format {
        PcmSampleFormat::S16 => {
            out.push(WaveCandidate {
                format: *format,
                container_bytes_per_sample: 2,
                packed_s24: false,
                wave: wave_pcm_ex(format.sample_rate, format.channels, 16),
            });
            out.push(WaveCandidate {
                format: *format,
                container_bytes_per_sample: 2,
                packed_s24: false,
                wave: wave_extensible_pcm(format.sample_rate, format.channels, 16, 16),
            });
        }
        PcmSampleFormat::S24 => {
            // 24-in-32 extensible (most DACs).
            out.push(WaveCandidate {
                format: *format,
                container_bytes_per_sample: 4,
                packed_s24: false,
                wave: wave_extensible_pcm(format.sample_rate, format.channels, 32, 24),
            });
            // Packed 24-bit PCM.
            out.push(WaveCandidate {
                format: *format,
                container_bytes_per_sample: 3,
                packed_s24: true,
                wave: wave_pcm_packed24(format.sample_rate, format.channels),
            });
            out.push(WaveCandidate {
                format: *format,
                container_bytes_per_sample: 3,
                packed_s24: true,
                wave: wave_extensible_pcm(format.sample_rate, format.channels, 24, 24),
            });
        }
        PcmSampleFormat::S32 => {
            out.push(WaveCandidate {
                format: *format,
                container_bytes_per_sample: 4,
                packed_s24: false,
                wave: wave_extensible_pcm(format.sample_rate, format.channels, 32, 32),
            });
            out.push(WaveCandidate {
                format: *format,
                container_bytes_per_sample: 4,
                packed_s24: false,
                wave: wave_pcm_ex(format.sample_rate, format.channels, 32),
            });
        }
        PcmSampleFormat::F32 => {
            out.push(WaveCandidate {
                format: *format,
                container_bytes_per_sample: 4,
                packed_s24: false,
                wave: wave_extensible_float(format.sample_rate, format.channels),
            });
            out.push(WaveCandidate {
                format: *format,
                container_bytes_per_sample: 4,
                packed_s24: false,
                wave: wave_ieee_float(format.sample_rate, format.channels),
            });
        }
    }
    out
}

fn channel_mask(channels: u16) -> u32 {
    match channels {
        1 => SPEAKER_FRONT_LEFT,
        2 => SPEAKER_STEREO,
        _ => {
            // Discrete mask: fill low N speaker bits (good enough for probe).
            (1u32 << channels.min(18)).saturating_sub(1)
        }
    }
}

fn wave_pcm_ex(sample_rate: u32, channels: u16, bits: u16) -> HeldWaveFormat {
    let block = channels.saturating_mul(bits / 8);
    let wfx = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: channels,
        nSamplesPerSec: sample_rate,
        nAvgBytesPerSec: sample_rate.saturating_mul(u32::from(block)),
        nBlockAlign: block,
        wBitsPerSample: bits,
        cbSize: 0,
    };
    held_from_wfx(&wfx)
}

fn wave_pcm_packed24(sample_rate: u32, channels: u16) -> HeldWaveFormat {
    let block = channels.saturating_mul(3);
    let wfx = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: channels,
        nSamplesPerSec: sample_rate,
        nAvgBytesPerSec: sample_rate.saturating_mul(u32::from(block)),
        nBlockAlign: block,
        wBitsPerSample: 24,
        cbSize: 0,
    };
    held_from_wfx(&wfx)
}

fn wave_ieee_float(sample_rate: u32, channels: u16) -> HeldWaveFormat {
    let block = channels.saturating_mul(4);
    let wfx = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT as u16,
        nChannels: channels,
        nSamplesPerSec: sample_rate,
        nAvgBytesPerSec: sample_rate.saturating_mul(u32::from(block)),
        nBlockAlign: block,
        wBitsPerSample: 32,
        cbSize: 0,
    };
    held_from_wfx(&wfx)
}

fn wave_extensible_pcm(
    sample_rate: u32,
    channels: u16,
    container_bits: u16,
    valid_bits: u16,
) -> HeldWaveFormat {
    let block = channels.saturating_mul(container_bits / 8);
    let ext = WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE,
            nChannels: channels,
            nSamplesPerSec: sample_rate,
            nAvgBytesPerSec: sample_rate.saturating_mul(u32::from(block)),
            nBlockAlign: block,
            wBitsPerSample: container_bits,
            cbSize: 22,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 {
            wValidBitsPerSample: valid_bits,
        },
        dwChannelMask: channel_mask(channels),
        SubFormat: SUBTYPE_PCM,
    };
    held_from_extensible(&ext)
}

fn wave_extensible_float(sample_rate: u32, channels: u16) -> HeldWaveFormat {
    let block = channels.saturating_mul(4);
    let ext = WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE,
            nChannels: channels,
            nSamplesPerSec: sample_rate,
            nAvgBytesPerSec: sample_rate.saturating_mul(u32::from(block)),
            nBlockAlign: block,
            wBitsPerSample: 32,
            cbSize: 22,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 {
            wValidBitsPerSample: 32,
        },
        dwChannelMask: channel_mask(channels),
        SubFormat: SUBTYPE_IEEE_FLOAT,
    };
    held_from_extensible(&ext)
}

fn held_from_wfx(wfx: &WAVEFORMATEX) -> HeldWaveFormat {
    let mut bytes = vec![0u8; std::mem::size_of::<WAVEFORMATEX>()];
    unsafe {
        std::ptr::copy_nonoverlapping(
            (wfx as *const WAVEFORMATEX).cast::<u8>(),
            bytes.as_mut_ptr(),
            bytes.len(),
        );
    }
    HeldWaveFormat { bytes }
}

fn held_from_extensible(ext: &WAVEFORMATEXTENSIBLE) -> HeldWaveFormat {
    let mut bytes = vec![0u8; std::mem::size_of::<WAVEFORMATEXTENSIBLE>()];
    unsafe {
        std::ptr::copy_nonoverlapping(
            (ext as *const WAVEFORMATEXTENSIBLE).cast::<u8>(),
            bytes.as_mut_ptr(),
            bytes.len(),
        );
    }
    HeldWaveFormat { bytes }
}

/// Build a WAVEFORMATEX blob matching negotiated metadata (fallback / tests only).
/// Prefer [`NegotiatedFormat::wave`] for Initialize.
pub fn wave_format_for_negotiated(negotiated: &NegotiatedFormat) -> HeldWaveFormat {
    negotiated.wave.clone()
}

/// Free a `WAVEFORMATEX*` allocated by WASAPI (`GetMixFormat` / closest match).
///
/// # Safety
///
/// `ptr` must be null or a live pointer allocated by COM with `CoTaskMemAlloc`.
/// It must not be used or freed again after this call.
pub unsafe fn free_wave_format(ptr: *mut WAVEFORMATEX) {
    if !ptr.is_null() {
        unsafe { CoTaskMemFree(Some(ptr.cast())) };
    }
}
