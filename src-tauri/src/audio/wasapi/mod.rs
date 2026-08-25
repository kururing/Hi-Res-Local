//! Windows WASAPI exclusive-mode output stack.
//!
//! Required `windows` crate features (see also `Cargo.toml` target cfg):
//! - `Win32_Media_Audio`
//! - `Win32_System_Com`
//! - `Win32_Media_Multimedia`
//! - `Win32_UI_Shell_PropertiesSystem`
//! - `Win32_Devices_FunctionDiscovery`
//! - `Win32_System_Threading`
//! - `Win32_Foundation`
//! - `Win32_System_Com_StructuredStorage`
//! - `Win32_System_Variant` (needed for `IMMDevice::Activate`)
//! - `Win32_Security` (needed for `CreateEventW` SECURITY_ATTRIBUTES)

pub mod device;
pub mod format;
pub mod output;

pub use device::WasapiDeviceManager;
pub use format::{FormatNegotiator, HeldWaveFormat, NegotiatedFormat, WasapiShareMode};
pub use output::WasapiExclusiveOutput;
