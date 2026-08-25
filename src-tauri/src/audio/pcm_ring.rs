//! Lock-free interleaved PCM byte ring (`ringbuf::HeapRb<u8>`).
//!
//! Sized for ~350ms of device PCM so the WASAPI render thread can survive
//! decode/UI spikes without underrunning.

use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};

use crate::audio::pcm::AudioFormat;

/// Target cushion kept in the byte ring (matches the f32 pipeline default).
pub const PCM_RING_MS: u32 = 350;

const MIN_CAPACITY_BYTES: usize = 4096;

/// Factory + capacity helpers around [`HeapRb<u8>`].
pub struct PcmRing {
    rb: HeapRb<u8>,
}

impl PcmRing {
    pub fn new(capacity_bytes: usize) -> Self {
        Self {
            rb: HeapRb::new(capacity_bytes.max(MIN_CAPACITY_BYTES)),
        }
    }

    /// Capacity for `duration_ms` of interleaved frames at `format`.
    pub fn for_format(format: &AudioFormat, duration_ms: u32) -> Self {
        Self::new(capacity_bytes_for(format, duration_ms))
    }

    /// Default ~350ms cushion for the given exclusive/output format.
    pub fn for_format_default(format: &AudioFormat) -> Self {
        Self::for_format(format, PCM_RING_MS)
    }

    pub fn capacity(&self) -> usize {
        self.rb.capacity().get()
    }

    pub fn split(self) -> (PcmRingProducer, PcmRingConsumer) {
        let (prod, cons) = self.rb.split();
        (
            PcmRingProducer { inner: prod },
            PcmRingConsumer { inner: cons },
        )
    }
}

/// Bytes writable into the ring (decode / mix side).
pub struct PcmRingProducer {
    inner: HeapProd<u8>,
}

impl PcmRingProducer {
    /// Push as many bytes as fit. Returns the count written.
    pub fn push_bytes(&mut self, data: &[u8]) -> usize {
        self.inner.push_slice(data)
    }

    /// Vacant byte slots available for writing.
    pub fn available(&self) -> usize {
        self.inner.vacant_len()
    }

    /// Occupied bytes waiting for the consumer.
    pub fn occupied(&self) -> usize {
        self.inner.occupied_len()
    }

    pub fn capacity(&self) -> usize {
        self.inner.capacity().get()
    }
}

/// Bytes readable from the ring (WASAPI render thread).
pub struct PcmRingConsumer {
    inner: HeapCons<u8>,
}

impl PcmRingConsumer {
    /// Pop up to `out.len()` bytes. Returns the count read.
    pub fn pop_bytes(&mut self, out: &mut [u8]) -> usize {
        self.inner.pop_slice(out)
    }

    /// Occupied bytes available to read.
    pub fn available(&self) -> usize {
        self.inner.occupied_len()
    }

    pub fn vacant(&self) -> usize {
        self.inner.vacant_len()
    }

    pub fn capacity(&self) -> usize {
        self.inner.capacity().get()
    }

    /// Drain all pending PCM (seek / reinit / stop).
    pub fn clear(&mut self) {
        let mut tmp = [0u8; 2048];
        while self.inner.pop_slice(&mut tmp) > 0 {}
    }
}

/// Byte capacity for `duration_ms` of `format` (interleaved).
pub fn capacity_bytes_for(format: &AudioFormat, duration_ms: u32) -> usize {
    let bpf = format.bytes_per_frame().max(1) as u64;
    let frames = (u64::from(format.sample_rate.max(1)) * u64::from(duration_ms.max(1))) / 1000;
    let bytes = frames.saturating_mul(bpf);
    (bytes as usize).max(MIN_CAPACITY_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::pcm::AudioFormat;

    #[test]
    fn capacity_tracks_350ms_stereo_48k_s16() {
        let fmt = AudioFormat::s16(48_000, 2);
        // 48000 * 0.35 * 4 bytes/frame = 67200
        assert_eq!(capacity_bytes_for(&fmt, 350), 67_200);
    }

    #[test]
    fn push_pop_roundtrip() {
        let (mut prod, mut cons) = PcmRing::new(64).split();
        assert_eq!(prod.push_bytes(&[1, 2, 3, 4]), 4);
        assert_eq!(cons.available(), 4);
        let mut out = [0u8; 8];
        assert_eq!(cons.pop_bytes(&mut out), 4);
        assert_eq!(&out[..4], &[1, 2, 3, 4]);
        cons.clear();
        assert_eq!(cons.available(), 0);
    }
}
