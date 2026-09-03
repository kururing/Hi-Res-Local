//! Shared audio core: probe, decode, DSD, MQA detect, DSP graph, output routing.

#![allow(clippy::manual_is_multiple_of)]

pub mod config;
pub mod decimator;
pub mod decoder;
pub mod dither;
pub mod dsd;
pub mod engine;
pub mod error;
pub mod graph;
pub mod mqa;
pub mod ndsd;
pub mod opus;
pub mod probe;
pub mod router;
pub mod source;
pub mod types;
pub mod wav;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use config::{AudioToml, SettingsPatch};
pub use decoder::{pack_s32_left_justified, PcmDecoder};
pub use dsd::{deinterleave_dsf_planar, DsdBlock, DsdSource, DstStatus};
pub use engine::{resolve_engine_kind, EngineKind};
pub use error::{CoreError, CoreResult};
pub use graph::ProcessingGraph;
pub use mqa::{MqaDetector, MqaEvidence, MqaInfo, MqaStatus};
pub use ndsd::NdsdSourceAdapter;
pub use probe::{AudioProbe, ProbeReport};
pub use router::{OutputRoute, OutputRouter, RouterInput};
pub use source::MediaSource;
pub use types::{AudioInfo, DecodedSampleRepr, DsdRate, PcmFormat};

/// Probe a file path (native convenience).
pub fn probe_path(path: &std::path::Path) -> CoreResult<ProbeReport> {
    let mut source = MediaSource::open_file(path)?;
    AudioProbe::inspect(&mut source)
}
