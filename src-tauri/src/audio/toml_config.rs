//! Optional `audio.toml` next to the desktop app data directory.
//! Runtime source of truth remains Settings UI + SQLite / localStorage.

use std::path::{Path, PathBuf};

use nnpm_audio_core::config::{AudioToml, SettingsPatch};
use nnpm_audio_core::engine::EngineKind;

pub fn audio_toml_path() -> Option<PathBuf> {
    let proj = directories::ProjectDirs::from("com", "nghenhacpromax", "app")?;
    Some(proj.config_dir().join("audio.toml"))
}

pub fn load_audio_toml() -> AudioToml {
    match audio_toml_path() {
        Some(path) => AudioToml::load_or_default(&path).unwrap_or_default(),
        None => AudioToml::default(),
    }
}

pub fn load_settings_patch() -> SettingsPatch {
    load_audio_toml().to_settings_patch()
}

pub fn resolve_desktop_engine(config_dir: Option<&Path>) -> EngineKind {
    if let Ok(value) = std::env::var("NNPM_AUDIO_ENGINE") {
        return EngineKind::parse(&value);
    }
    let toml = match config_dir {
        Some(dir) => AudioToml::load_or_default(&dir.join("audio.toml")).unwrap_or_default(),
        None => load_audio_toml(),
    };
    toml.engine_kind()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_env_overrides_toml() {
        std::env::set_var("NNPM_AUDIO_ENGINE", "compare");
        assert_eq!(resolve_desktop_engine(None), EngineKind::Compare);
        std::env::remove_var("NNPM_AUDIO_ENGINE");
    }
}
