//! Output router: capability + user preference → one playback route.
//! Native DSD / DoP never auto-select outside Advanced.

use serde::{Deserialize, Serialize};

use crate::types::DsdRate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackMode {
    Auto,
    HighQuality,
    Multitask,
    Advanced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioBackend {
    Shared,
    WasapiExclusive,
    Asio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DsdOutputMode {
    NativeDsd,
    Dop,
    Pcm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputRoute {
    NativeDsd,
    Dop,
    ExclusiveBitPerfect,
    ExclusivePcm,
    Shared,
    WebAudio,
}

impl OutputRoute {
    pub const fn skips_dsp(self) -> bool {
        matches!(
            self,
            Self::NativeDsd | Self::Dop | Self::ExclusiveBitPerfect
        )
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::NativeDsd => "ASIO Native DSD",
            Self::Dop => "WASAPI Exclusive DoP",
            Self::ExclusiveBitPerfect => "WASAPI Exclusive bit-perfect",
            Self::ExclusivePcm => "WASAPI Exclusive PCM",
            Self::Shared => "WASAPI Shared",
            Self::WebAudio => "Web Audio PCM",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DacCaps {
    pub exclusive: bool,
    pub dop_rates: Vec<DsdRate>,
    pub native_dsd_rates: Vec<DsdRate>,
    pub mqa_renderer: bool,
    pub web: bool,
}

impl Default for DacCaps {
    fn default() -> Self {
        Self {
            exclusive: true,
            dop_rates: Vec::new(),
            native_dsd_rates: Vec::new(),
            mqa_renderer: false,
            web: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RouterInput {
    pub mode: PlaybackMode,
    pub is_dsd: bool,
    pub is_mqa: bool,
    pub dsd_rate: Option<DsdRate>,
    pub backend: AudioBackend,
    pub dsd_mode: DsdOutputMode,
    pub bit_perfect: bool,
    pub mqa_passthrough: bool,
    pub caps: DacCaps,
}

pub struct OutputRouter;

impl OutputRouter {
    /// Ordered fallback plan. Auto/HQ never include Native DSD or DoP.
    pub fn plan(input: &RouterInput) -> Vec<OutputRoute> {
        if input.caps.web {
            return vec![OutputRoute::WebAudio];
        }
        match input.mode {
            PlaybackMode::Multitask => vec![OutputRoute::Shared],
            PlaybackMode::Auto | PlaybackMode::HighQuality => {
                if input.is_dsd {
                    vec![OutputRoute::ExclusivePcm, OutputRoute::Shared]
                } else if input.bit_perfect {
                    vec![
                        OutputRoute::ExclusiveBitPerfect,
                        OutputRoute::ExclusivePcm,
                        OutputRoute::Shared,
                    ]
                } else {
                    vec![OutputRoute::ExclusivePcm, OutputRoute::Shared]
                }
            }
            PlaybackMode::Advanced => {
                if input.is_dsd {
                    match (input.backend, input.dsd_mode) {
                        (AudioBackend::Asio, _) | (_, DsdOutputMode::NativeDsd) => {
                            vec![OutputRoute::NativeDsd]
                        }
                        (AudioBackend::Shared, DsdOutputMode::Dop) => {
                            vec![OutputRoute::Shared]
                        }
                        // Advanced transport is fail-closed. Capability/rate
                        // rejection is reported by the DoP opener.
                        (_, DsdOutputMode::Dop) => vec![OutputRoute::Dop],
                        (AudioBackend::Shared, DsdOutputMode::Pcm) => {
                            vec![OutputRoute::Shared]
                        }
                        _ => vec![OutputRoute::ExclusivePcm],
                    }
                } else if input.is_mqa && input.mqa_passthrough {
                    vec![OutputRoute::ExclusiveBitPerfect]
                } else if input.backend == AudioBackend::WasapiExclusive && input.bit_perfect {
                    vec![OutputRoute::ExclusiveBitPerfect]
                } else if input.backend == AudioBackend::WasapiExclusive {
                    vec![OutputRoute::ExclusivePcm]
                } else {
                    vec![OutputRoute::Shared]
                }
            }
        }
    }

    pub fn select(input: &RouterInput) -> OutputRoute {
        let plan = Self::plan(input);
        for route in plan {
            if Self::available(route, input) {
                return route;
            }
        }
        if input.caps.web {
            OutputRoute::WebAudio
        } else {
            OutputRoute::Shared
        }
    }

    fn available(route: OutputRoute, input: &RouterInput) -> bool {
        match route {
            OutputRoute::NativeDsd => {
                let Some(rate) = input.dsd_rate else {
                    return false;
                };
                input.caps.native_dsd_rates.contains(&rate)
            }
            OutputRoute::Dop => {
                let Some(rate) = input.dsd_rate else {
                    return false;
                };
                rate.dop_supported() && input.caps.dop_rates.contains(&rate)
            }
            OutputRoute::ExclusiveBitPerfect | OutputRoute::ExclusivePcm => input.caps.exclusive,
            OutputRoute::Shared | OutputRoute::WebAudio => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm_auto() -> RouterInput {
        RouterInput {
            mode: PlaybackMode::Auto,
            is_dsd: false,
            is_mqa: false,
            dsd_rate: None,
            backend: AudioBackend::Shared,
            dsd_mode: DsdOutputMode::Pcm,
            bit_perfect: true,
            mqa_passthrough: false,
            caps: DacCaps::default(),
        }
    }

    #[test]
    fn auto_never_selects_native_or_dop() {
        let mut input = pcm_auto();
        input.is_dsd = true;
        input.dsd_rate = Some(DsdRate::Dsd64);
        input.caps.native_dsd_rates = vec![DsdRate::Dsd64];
        input.caps.dop_rates = vec![DsdRate::Dsd64];
        let plan = OutputRouter::plan(&input);
        assert!(!plan.contains(&OutputRoute::NativeDsd));
        assert!(!plan.contains(&OutputRoute::Dop));
    }

    #[test]
    fn advanced_dsd512_dop_fails_closed_without_pcm_fallback() {
        let input = RouterInput {
            mode: PlaybackMode::Advanced,
            is_dsd: true,
            is_mqa: false,
            dsd_rate: Some(DsdRate::Dsd512),
            backend: AudioBackend::WasapiExclusive,
            dsd_mode: DsdOutputMode::Dop,
            bit_perfect: false,
            mqa_passthrough: false,
            caps: DacCaps {
                exclusive: true,
                dop_rates: vec![DsdRate::Dsd64],
                native_dsd_rates: vec![],
                mqa_renderer: false,
                web: false,
            },
        };
        assert_eq!(OutputRouter::plan(&input), vec![OutputRoute::Dop]);
        assert!(!DsdRate::Dsd1024.dop_supported());
    }

    #[test]
    fn verified_mqa_passthrough_forces_exclusive_bit_perfect() {
        let mut input = pcm_auto();
        input.mode = PlaybackMode::Advanced;
        input.backend = AudioBackend::Shared;
        input.is_mqa = true;
        input.mqa_passthrough = true;
        assert_eq!(
            OutputRouter::plan(&input),
            vec![OutputRoute::ExclusiveBitPerfect]
        );

        input.is_mqa = false;
        assert_eq!(OutputRouter::plan(&input), vec![OutputRoute::Shared]);
    }
}
