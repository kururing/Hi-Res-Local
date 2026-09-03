//! NdsdSourceAdapter — wraps ndsd-read when available, otherwise the in-tree parser.
//! Public types never leak `ndsd_read::*`.

use crate::dsd::{DsdBlock, DsdFormat, DsdSource, ParsedDsdSource};
use crate::error::CoreResult;
use crate::source::MediaSource;

pub struct NdsdSourceAdapter {
    inner: Inner,
}

enum Inner {
    Parsed(ParsedDsdSource),
    #[cfg(all(feature = "dst-native", not(target_arch = "wasm32")))]
    Ndsd {
        reader: Box<dyn ndsd_read::DSDReader>,
        format: DsdFormat,
        timestamp_ms: u64,
    },
}

impl NdsdSourceAdapter {
    pub fn open(source: MediaSource) -> CoreResult<Self> {
        #[cfg(all(feature = "dst-native", not(target_arch = "wasm32")))]
        {
            if let Some(path) = source.path() {
                return open_ndsd(path);
            }
        }
        Ok(Self {
            inner: Inner::Parsed(ParsedDsdSource::open(source)?),
        })
    }

    pub fn format(&self) -> &DsdFormat {
        match &self.inner {
            Inner::Parsed(p) => p.info(),
            #[cfg(all(feature = "dst-native", not(target_arch = "wasm32")))]
            Inner::Ndsd { format, .. } => format,
        }
    }
}

impl DsdSource for NdsdSourceAdapter {
    fn info(&self) -> &DsdFormat {
        self.format()
    }

    fn next_block(&mut self, max_bytes: usize) -> CoreResult<Option<DsdBlock>> {
        match &mut self.inner {
            Inner::Parsed(p) => p.next_block(max_bytes),
            #[cfg(all(feature = "dst-native", not(target_arch = "wasm32")))]
            Inner::Ndsd {
                reader,
                format,
                timestamp_ms,
            } => {
                let channels = usize::from(format.channels.max(1));
                let bytes_per_channel = (max_bytes / channels).max(1);
                let mut channel_data = vec![vec![0u8; bytes_per_channel]; channels];
                let mut slices: Vec<&mut [u8]> =
                    channel_data.iter_mut().map(Vec::as_mut_slice).collect();
                let read = reader
                    .read(&mut slices, bytes_per_channel)
                    .map_err(|e| crate::error::CoreError::Decode(format!("ndsd-read: {e}")))?;
                if read == 0 {
                    return Ok(None);
                }

                // ndsd-read exposes planar channel buffers. The rest of the engine
                // consumes one byte per channel for each DSD byte-frame.
                let mut bytes = Vec::with_capacity(read * channels);
                for byte_index in 0..read {
                    for channel in &channel_data {
                        bytes.push(channel[byte_index]);
                    }
                }
                let block_timestamp = *timestamp_ms;
                let samples = (read as u64).saturating_mul(8);
                *timestamp_ms = timestamp_ms.saturating_add(
                    samples.saturating_mul(1000) / u64::from(format.dsd_sample_rate.max(1)),
                );
                Ok(Some(DsdBlock {
                    bytes,
                    channels: format.channels,
                    dsd_rate: format.dsd_rate,
                    lsb_first: format.lsb_first,
                    timestamp_ms: block_timestamp,
                    dst: format.dst_status,
                }))
            }
        }
    }

    fn seek_ms(&mut self, target_ms: u64) -> CoreResult<u64> {
        match &mut self.inner {
            Inner::Parsed(p) => p.seek_ms(target_ms),
            #[cfg(all(feature = "dst-native", not(target_arch = "wasm32")))]
            Inner::Ndsd {
                reader,
                format,
                timestamp_ms,
            } => {
                let clamped = target_ms.min(format.duration_ms);
                let sample = clamped.saturating_mul(u64::from(format.dsd_sample_rate)) / 1000;
                reader
                    .seek_samples(sample / 8)
                    .map_err(|e| crate::error::CoreError::Decode(format!("ndsd-read seek: {e}")))?;
                *timestamp_ms = clamped;
                Ok(clamped)
            }
        }
    }

    fn flush(&mut self) {
        match &mut self.inner {
            Inner::Parsed(p) => p.flush(),
            #[cfg(all(feature = "dst-native", not(target_arch = "wasm32")))]
            Inner::Ndsd { .. } => {}
        }
    }
}

#[cfg(all(feature = "dst-native", not(target_arch = "wasm32")))]
fn open_ndsd(path: &std::path::Path) -> CoreResult<NdsdSourceAdapter> {
    use std::io::Read;

    // Keep the richer container/encoding information from the core header parser,
    // but make ndsd-read the actual streaming reader for local DSF/DFF files.
    let mut source = MediaSource::open_file(path)?;
    let mut head = vec![0u8; 256 * 1024];
    let n = source.read(&mut head)?;
    head.truncate(n);
    let mut format = crate::dsd::parse_header(&head, source.len())?;

    let path = path.to_str().ok_or_else(|| {
        crate::error::CoreError::InvalidSource("ndsd-read requires a UTF-8 local file path".into())
    })?;
    let mut ndsd_format = ndsd_read::DSDFormat::default();
    let reader = ndsd_read::open_dsd_auto(path, &mut ndsd_format)
        .map_err(|e| crate::error::CoreError::Decode(format!("ndsd-read: {e}")))?;

    format.dsd_sample_rate = ndsd_format.sampling_rate;
    format.dsd_rate = crate::types::dsd_rate_from_sample_rate(ndsd_format.sampling_rate)
        .ok_or_else(|| {
            crate::error::CoreError::Unsupported(format!(
                "unsupported DSD rate {}",
                ndsd_format.sampling_rate
            ))
        })?;
    format.channels = u16::try_from(ndsd_format.num_channels).map_err(|_| {
        crate::error::CoreError::Unsupported("DSD channel count is too large".into())
    })?;
    format.sample_count = match format.container {
        // DSF stores a one-bit sample count; DFF's reader reports byte-frames.
        crate::dsd::DsdContainer::Dsf => ndsd_format.total_samples,
        crate::dsd::DsdContainer::Dff => ndsd_format.total_samples.saturating_mul(8),
    };
    format.duration_ms =
        format.sample_count.saturating_mul(1000) / u64::from(format.dsd_sample_rate.max(1));
    format.lsb_first = ndsd_format.is_lsb_first;

    Ok(NdsdSourceAdapter {
        inner: Inner::Ndsd {
            reader,
            format,
            timestamp_ms: 0,
        },
    })
}

#[cfg(all(test, feature = "dst-native", not(target_arch = "wasm32")))]
mod tests {
    use std::io::Write;

    use super::*;

    #[test]
    fn local_dsf_is_streamed_by_ndsd_and_interleaved() {
        let mut bytes = crate::dsd::create_minimal_dsf();
        bytes[92..100].copy_from_slice(&[0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]);
        bytes[100..108].copy_from_slice(&[0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27]);
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(&bytes).unwrap();

        let source = MediaSource::open_file(file.path()).unwrap();
        let mut adapter = NdsdSourceAdapter::open(source).unwrap();
        let block = adapter.next_block(16).unwrap().unwrap();

        assert_eq!(
            block.bytes,
            vec![
                0x10, 0x20, 0x11, 0x21, 0x12, 0x22, 0x13, 0x23, 0x14, 0x24, 0x15, 0x25, 0x16, 0x26,
                0x17, 0x27,
            ]
        );
        assert_eq!(adapter.seek_ms(0).unwrap(), 0);
    }
}
