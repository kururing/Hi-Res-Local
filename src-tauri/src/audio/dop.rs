//! DSD-over-PCM (DoP 1.1) encapsulation.
//!
//! DoP carries the unmodified 1-bit DSD payload inside 24-bit PCM samples:
//! the top byte alternates between the markers `0x05` / `0xFA` and the lower
//! 16 bits hold 16 consecutive DSD bits (MSB first, earlier bits in the more
//! significant byte). The PCM frame rate is therefore `dsd_rate / 16`
//! (DSD64 → 176.4 kHz, DSD128 → 352.8 kHz).
//!
//! This module also owns [`RawDsdStream`], the channel-interleaved MSB-first
//! raw DSD byte reader shared by the ASIO native path and the DoP packer.

#![allow(clippy::chunks_exact_to_as_chunks)] // `as_chunks` is newer than the Rust 1.80 MSRV.

use std::path::{Path, PathBuf};

use crate::audio::dsd::{DsdEncoding, DsdFormat};
use crate::audio::error::{AudioError, AudioResult};
use nnpm_audio_core::dsd::DsdSource;
use nnpm_audio_core::ndsd::NdsdSourceAdapter;
use nnpm_audio_core::source::MediaSource;

pub const DOP_MARKER_A: u8 = 0x05;
pub const DOP_MARKER_B: u8 = 0xFA;

/// Raw DSD bytes pulled from the reader per packet.
pub const RAW_PACKET_BYTES: usize = 256 * 1024;

/// PCM frame rate of the DoP encapsulation for a DSD bit rate in Hz.
pub const fn dop_pcm_rate(dsd_sample_rate: u32) -> u32 {
    dsd_sample_rate / 16
}

/// WASAPI `EndpointFormFactor::UnknownDigitalPassthrough`.
pub const FORM_FACTOR_UNKNOWN_DIGITAL: u32 = 7;
/// WASAPI `EndpointFormFactor::SPDIF`.
pub const FORM_FACTOR_SPDIF: u32 = 8;
/// WASAPI `EndpointFormFactor::DigitalAudioDisplayDevice` (HDMI).
pub const FORM_FACTOR_HDMI: u32 = 9;

const DOP_NAME_DENYLIST: &[&str] = &[
    "realtek",
    "nvidia",
    "amd hdmi",
    "amd high definition",
    "intel display",
    "intel(r) display",
    "conexant",
    "hands-free",
    "handsfree",
    "hdmi",
    "displayport",
    "display port",
];

/// Whether this render endpoint is even a candidate for DoP.
///
/// WASAPI can only prove Exclusive 24-bit PCM at a DoP frame rate. That is a
/// necessary wire condition, not proof the DAC decodes `0x05`/`0xFA` markers.
/// HDMI, Bluetooth, onboard HD Audio, and known PCM-only names are rejected
/// so Realtek/HDMI do not advertise DoP (which would play as static).
pub fn dop_endpoint_eligible(enumerator: &str, form_factor: u32, friendly_name: &str) -> bool {
    if form_factor == FORM_FACTOR_HDMI {
        return false;
    }
    let enumerator_l = enumerator.to_ascii_uppercase();
    if enumerator_l.contains("BTH") || enumerator_l.contains("BLUETOOTH") {
        return false;
    }
    if enumerator_l.contains("HDAUDIO") {
        return false;
    }
    let name_l = friendly_name.to_ascii_lowercase();
    if DOP_NAME_DENYLIST.iter().any(|deny| name_l.contains(deny)) {
        return false;
    }
    if enumerator_l.contains("USB") {
        return true;
    }
    if form_factor == FORM_FACTOR_SPDIF || form_factor == FORM_FACTOR_UNKNOWN_DIGITAL {
        return true;
    }
    enumerator.trim().is_empty() && (name_l.contains("usb") || name_l.contains("dac"))
}

/// Map Exclusive PCM successes onto all supported DSD-over-PCM rates.
pub fn advertised_dop_rates(
    mut pcm_exclusive_ok: impl FnMut(u32) -> bool,
) -> Vec<crate::audio::dto::DsdRate> {
    use crate::audio::dto::DsdRate;
    let mut rates = Vec::new();
    for rate in DsdRate::ADVERTISED_DOP {
        if rate.dop_pcm_rates().into_iter().any(&mut pcm_exclusive_ok) {
            rates.push(rate);
        }
    }
    rates
}

/// True when this DSD bit rate is one of the advertised DoP rates.
pub fn dop_sample_rate_is_advertised(
    dsd_sample_rate: u32,
    advertised: &[crate::audio::dto::DsdRate],
) -> bool {
    crate::audio::dsd::dsd_rate_from_sample_rate(dsd_sample_rate)
        .is_ok_and(|rate| advertised.contains(&rate))
}

/// Sequential raw DSD source: channel-interleaved bytes, MSB-first bit order
/// (DSF bytes are bit-reversed by the reader; DST frames are decompressed).
#[allow(clippy::large_enum_variant)] // Kept inline on the realtime path to avoid an extra allocation.
pub enum RawDsdStream {
    Core(NdsdSourceAdapter),
}

impl RawDsdStream {
    pub fn open(path: &Path) -> AudioResult<(DsdFormat, Self)> {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !extension.eq_ignore_ascii_case("dsf") && !extension.eq_ignore_ascii_case("dff") {
            return Err(AudioError::UnsupportedFormat {
                path: path.to_path_buf(),
                details: "Raw DSD accepts .dsf or .dff; standalone .dst is not supported".into(),
            });
        }
        let source =
            MediaSource::open_file(path).map_err(|error| AudioError::UnsupportedFormat {
                path: path.to_path_buf(),
                details: error.to_string(),
            })?;
        let adapter =
            NdsdSourceAdapter::open(source).map_err(|error| AudioError::UnsupportedFormat {
                path: path.to_path_buf(),
                details: error.to_string(),
            })?;
        let core = adapter.format();
        let format = DsdFormat {
            container: match core.container {
                nnpm_audio_core::dsd::DsdContainer::Dsf => crate::audio::dsd::DsdContainer::Dsf,
                nnpm_audio_core::dsd::DsdContainer::Dff => crate::audio::dsd::DsdContainer::Dff,
            },
            encoding: match core.encoding {
                nnpm_audio_core::dsd::DsdEncoding::Raw => DsdEncoding::Raw,
                nnpm_audio_core::dsd::DsdEncoding::Dst => DsdEncoding::Dst,
            },
            dsd_sample_rate: core.dsd_sample_rate,
            pcm_sample_rate: core.dsd_sample_rate / 8,
            dsd_rate: crate::audio::dsd::dsd_rate_from_sample_rate(core.dsd_sample_rate).map_err(
                |error| AudioError::UnsupportedFormat {
                    path: path.to_path_buf(),
                    details: error.to_string(),
                },
            )?,
            channels: core.channels,
            sample_count: core.sample_count,
            duration_ms: core.duration_ms,
            data_offset: core.data_offset,
            data_size: core.data_size,
            block_size: core.block_size,
            lsb_first: core.lsb_first,
            dst_frame_rate: None,
            dst_frames: Vec::new(),
            id3: None,
        };
        Ok((format, Self::Core(adapter)))
    }

    pub fn seek_ms(&mut self, target_ms: u64) {
        match self {
            Self::Core(reader) => {
                let _ = reader.seek_ms(target_ms);
            }
        }
    }

    pub fn next_bytes(&mut self) -> AudioResult<Option<Vec<u8>>> {
        match self {
            Self::Core(reader) => {
                let Some(mut block) = reader.next_block(RAW_PACKET_BYTES).map_err(|error| {
                    AudioError::DecodeError {
                        path: PathBuf::new(),
                        details: error.to_string(),
                    }
                })?
                else {
                    return Ok(None);
                };
                if block.lsb_first {
                    block
                        .bytes
                        .iter_mut()
                        .for_each(|byte| *byte = byte.reverse_bits());
                }
                Ok(Some(block.bytes))
            }
        }
    }
}

/// Streaming packer: channel-interleaved MSB-first DSD bytes → little-endian
/// DoP PCM samples. Keeps sub-frame leftovers between calls so packets of any
/// length stay marker-aligned.
pub struct DopPacker {
    channels: usize,
    marker: u8,
    pending: Vec<u8>,
}

impl DopPacker {
    pub fn new(channels: u16) -> Self {
        Self {
            channels: usize::from(channels.max(1)),
            marker: DOP_MARKER_A,
            pending: Vec::new(),
        }
    }

    /// Restart marker phase and drop buffered leftovers (after a seek).
    pub fn reset(&mut self) {
        self.marker = DOP_MARKER_A;
        self.pending.clear();
    }

    /// Append DoP-packed samples to `out`.
    ///
    /// One DoP frame consumes 2 DSD bytes per channel: the earlier byte lands
    /// in the more significant payload position. `packed_s24` selects the
    /// 3-byte packed container; otherwise 24-in-32 (value << 8, low byte 0)
    /// is written — both little-endian, matching the WASAPI exclusive wire.
    pub fn pack_into(&mut self, dsd: &[u8], packed_s24: bool, out: &mut Vec<u8>) {
        if !dsd.is_empty() {
            self.pending.extend_from_slice(dsd);
        }
        let group = self.channels * 2;
        let frames = self.pending.len() / group;
        if frames == 0 {
            return;
        }
        let sample_bytes = if packed_s24 { 3 } else { 4 };
        out.reserve(frames * self.channels * sample_bytes);
        for frame in 0..frames {
            let base = frame * group;
            for channel in 0..self.channels {
                let early = self.pending[base + channel];
                let late = self.pending[base + self.channels + channel];
                if packed_s24 {
                    out.extend_from_slice(&[late, early, self.marker]);
                } else {
                    out.extend_from_slice(&[0, late, early, self.marker]);
                }
            }
            self.marker = if self.marker == DOP_MARKER_A {
                DOP_MARKER_B
            } else {
                DOP_MARKER_A
            };
        }
        self.pending.drain(..frames * group);
    }
}

/// Sequential DoP source for the decode thread: raw DSD file → DoP PCM bytes.
pub struct DopReader {
    path: PathBuf,
    format: DsdFormat,
    stream: RawDsdStream,
    packer: DopPacker,
    packed_s24: bool,
}

impl DopReader {
    pub fn open(path: &Path) -> AudioResult<Self> {
        let (format, stream) = RawDsdStream::open(path)?;
        let packer = DopPacker::new(format.channels);
        Ok(Self {
            path: path.to_path_buf(),
            format,
            stream,
            packer,
            packed_s24: false,
        })
    }

    pub fn format(&self) -> &DsdFormat {
        &self.format
    }

    /// PCM frame rate of the DoP stream (`dsd_rate / 16`).
    pub fn pcm_rate(&self) -> u32 {
        dop_pcm_rate(self.format.dsd_sample_rate)
    }

    /// Select the negotiated wire container (packed 3-byte vs 24-in-32).
    pub fn set_wire(&mut self, packed_s24: bool) {
        self.packed_s24 = packed_s24;
    }

    /// Next chunk of DoP-packed PCM bytes; `None` at end of stream.
    pub fn next_dop_bytes(&mut self) -> AudioResult<Option<Vec<u8>>> {
        loop {
            match self.stream.next_bytes()? {
                Some(raw) => {
                    let mut out = Vec::new();
                    self.packer.pack_into(&raw, self.packed_s24, &mut out);
                    if out.is_empty() {
                        // Packet shorter than one DoP frame; read more.
                        continue;
                    }
                    return Ok(Some(out));
                }
                None => return Ok(None),
            }
        }
    }

    /// Seek by reopening the raw stream at the nearest DSD block boundary.
    pub fn seek_ms(&mut self, target_ms: u64) -> AudioResult<u64> {
        let (format, mut stream) = RawDsdStream::open(&self.path)?;
        debug_assert_eq!(format.channels, self.format.channels);
        let clamped = target_ms.min(self.format.duration_ms);
        stream.seek_ms(clamped);
        self.stream = stream;
        self.packer.reset();
        Ok(clamped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unpack_frames_32(out: &[u8], channels: usize) -> Vec<Vec<[u8; 4]>> {
        out.chunks_exact(4 * channels)
            .map(|frame| {
                frame
                    .chunks_exact(4)
                    .map(|s| [s[0], s[1], s[2], s[3]])
                    .collect()
            })
            .collect()
    }

    #[test]
    fn dop_pcm_rates_match_spec() {
        assert_eq!(dop_pcm_rate(2_822_400), 176_400); // DSD64
        assert_eq!(dop_pcm_rate(5_644_800), 352_800); // DSD128
        assert_eq!(dop_pcm_rate(3_072_000), 192_000); // DSD64 48 kHz family
        assert_eq!(crate::audio::dto::DsdRate::Dsd64.dop_pcm_rate(), 176_400);
        assert_eq!(crate::audio::dto::DsdRate::Dsd128.dop_pcm_rate(), 352_800);
        assert_eq!(crate::audio::dto::DsdRate::Dsd64.dop_pcm_rate_48(), 192_000);
        assert_eq!(
            crate::audio::dto::DsdRate::Dsd128.sample_rate_families_hz(),
            [5_644_800, 6_144_000]
        );
    }

    #[test]
    fn rejects_hdmi_realtek_and_bluetooth_endpoints() {
        assert!(!dop_endpoint_eligible(
            "USB",
            FORM_FACTOR_HDMI,
            "NVIDIA HDMI"
        ));
        assert!(!dop_endpoint_eligible(
            "HDAUDIO",
            1,
            "Speakers (Realtek(R) Audio)"
        ));
        assert!(!dop_endpoint_eligible("USB", 1, "Realtek USB Audio"));
        assert!(!dop_endpoint_eligible("BTHHFENUM", 3, "WH-1000XM5"));
        assert!(!dop_endpoint_eligible(
            "USB",
            1,
            "Headphones Hands-Free AG Audio"
        ));
        assert!(!dop_endpoint_eligible("USB", 1, "Intel Display Audio"));
    }

    #[test]
    fn allows_usb_dac_and_spdif() {
        assert!(dop_endpoint_eligible("USB", 1, "Topping D90"));
        assert!(dop_endpoint_eligible("USB", 3, "iFi Zen DAC"));
        assert!(dop_endpoint_eligible(
            "PCI",
            FORM_FACTOR_SPDIF,
            "Optical Out"
        ));
        assert!(dop_endpoint_eligible("", 1, "SMSL USB DAC"));
    }

    #[test]
    fn advertised_dop_caps_include_all_supported_rates() {
        use crate::audio::dto::DsdRate;
        let with_256 = advertised_dop_rates(|pcm| matches!(pcm, 176_400 | 352_800 | 705_600));
        assert_eq!(
            with_256,
            vec![DsdRate::Dsd64, DsdRate::Dsd128, DsdRate::Dsd256]
        );
        assert!(advertised_dop_rates(|pcm| pcm == 1_411_200).is_empty());
        let family_48 = advertised_dop_rates(|pcm| pcm == 192_000);
        assert_eq!(family_48, vec![DsdRate::Dsd64]);
        assert!(dop_sample_rate_is_advertised(2_822_400, &family_48));
        assert!(dop_sample_rate_is_advertised(3_072_000, &family_48));
        assert!(dop_sample_rate_is_advertised(11_289_600, &with_256));
    }

    #[test]
    fn markers_alternate_and_payload_is_preserved_stereo() {
        // Stereo, 2 DoP frames: input is channel-interleaved
        // [L0, R0, L1, R1, L2, R2, L3, R3].
        let mut packer = DopPacker::new(2);
        let input = [0x80, 0x01, 0x40, 0x02, 0x20, 0x03, 0x10, 0x04];
        let mut out = Vec::new();
        packer.pack_into(&input, false, &mut out);

        let frames = unpack_frames_32(&out, 2);
        assert_eq!(frames.len(), 2);
        // Frame 0: marker 0x05. LE layout: [0, late, early, marker].
        assert_eq!(frames[0][0], [0x00, 0x40, 0x80, DOP_MARKER_A]); // L: early 0x80, late 0x40
        assert_eq!(frames[0][1], [0x00, 0x02, 0x01, DOP_MARKER_A]); // R: early 0x01, late 0x02
                                                                    // Frame 1: marker 0xFA.
        assert_eq!(frames[1][0], [0x00, 0x10, 0x20, DOP_MARKER_B]);
        assert_eq!(frames[1][1], [0x00, 0x04, 0x03, DOP_MARKER_B]);
    }

    #[test]
    fn packed_s24_layout_matches_wire() {
        let mut packer = DopPacker::new(2);
        let input = [0xAA, 0xBB, 0xCC, 0xDD];
        let mut out = Vec::new();
        packer.pack_into(&input, true, &mut out);
        // One frame, 2 channels × 3 bytes: [late, early, marker].
        assert_eq!(
            out,
            vec![0xCC, 0xAA, DOP_MARKER_A, 0xDD, 0xBB, DOP_MARKER_A]
        );
    }

    #[test]
    fn leftover_bytes_carry_across_packets() {
        let mut packer = DopPacker::new(2);
        let mut out = Vec::new();
        // 3 bytes: less than one stereo frame (needs 4) → nothing emitted yet.
        packer.pack_into(&[0x11, 0x22, 0x33], false, &mut out);
        assert!(out.is_empty());
        // One more byte completes the frame; payload order must be preserved.
        packer.pack_into(&[0x44], false, &mut out);
        let frames = unpack_frames_32(&out, 2);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0][0], [0x00, 0x33, 0x11, DOP_MARKER_A]);
        assert_eq!(frames[0][1], [0x00, 0x44, 0x22, DOP_MARKER_A]);
    }

    #[test]
    fn marker_phase_continues_across_packets_and_resets() {
        let mut packer = DopPacker::new(1);
        let mut out = Vec::new();
        packer.pack_into(&[0x01, 0x02], false, &mut out); // frame 0 → 0x05
        packer.pack_into(&[0x03, 0x04], false, &mut out); // frame 1 → 0xFA
        packer.pack_into(&[0x05, 0x06], false, &mut out); // frame 2 → 0x05
        let frames = unpack_frames_32(&out, 1);
        assert_eq!(frames[0][0][3], DOP_MARKER_A);
        assert_eq!(frames[1][0][3], DOP_MARKER_B);
        assert_eq!(frames[2][0][3], DOP_MARKER_A);

        packer.reset();
        out.clear();
        packer.pack_into(&[0x07, 0x08], false, &mut out);
        let frames = unpack_frames_32(&out, 1);
        assert_eq!(frames[0][0][3], DOP_MARKER_A);
    }

    #[test]
    fn dsd64_and_dsd128_second_alignment() {
        // One second of DSD64 stereo = 2 822 400 bits/ch = 352 800 bytes/ch.
        // DoP frames per second must equal the DoP PCM rate.
        for (dsd_hz, expected_frames) in [(2_822_400u32, 176_400usize), (5_644_800, 352_800)] {
            let bytes_per_channel = (dsd_hz / 8) as usize;
            let mut packer = DopPacker::new(2);
            let input = vec![0x69u8; bytes_per_channel * 2];
            let mut out = Vec::new();
            packer.pack_into(&input, false, &mut out);
            let frames = out.len() / (4 * 2);
            assert_eq!(frames, expected_frames);
            assert_eq!(frames as u32, dop_pcm_rate(dsd_hz));
            // Payload preserved: every sample carries 0x69 0x69 in bits 8..24.
            assert!(out
                .chunks_exact(4)
                .all(|s| s[0] == 0 && s[1] == 0x69 && s[2] == 0x69));
        }
    }
}
