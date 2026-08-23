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
        }
    }
}
