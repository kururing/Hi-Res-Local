use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LibraryRoot {
    pub id: String,
    pub path: String,
    pub name: String,
    pub is_active: bool,
    pub last_scanned_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    pub library_roots: Vec<LibraryRoot>,
    pub theme: String,
    pub language: String,
    pub output_device: Option<String>,
    pub auto_scan_on_startup: bool,
    pub watch_directories: bool,
    pub crossfade_duration_ms: u32,
    pub exclusive_audio_mode: bool,
    pub volume: f32,
    #[serde(default = "default_dsd_output_mode")]
    pub dsd_output_mode: String,
    #[serde(default = "default_audio_backend")]
    pub audio_backend: String,
    #[serde(default)]
    pub asio_driver_id: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            library_roots: Vec::new(),
            theme: "system".to_string(),
            language: "vi".to_string(),
            output_device: None,
            auto_scan_on_startup: true,
            watch_directories: true,
            crossfade_duration_ms: 0,
            exclusive_audio_mode: false,
            volume: 1.0,
            dsd_output_mode: default_dsd_output_mode(),
            audio_backend: default_audio_backend(),
            asio_driver_id: None,
        }
    }
}

fn default_dsd_output_mode() -> String {
    "native_dsd".into()
}

fn default_audio_backend() -> String {
    "shared".into()
}
