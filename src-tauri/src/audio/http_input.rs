use std::collections::HashSet;
use std::path::{Path, PathBuf};

use nnpm_audio_core::source::{http_host, validate_http_url};

use crate::audio::error::{AudioError, AudioResult};

pub fn redact_stream_url(url: &str) -> String {
    match url.find('?') {
        Some(index) => format!("{}?[redacted]", &url[..index]),
        None => url.to_string(),
    }
}

pub fn is_http_stream_url(url: &str) -> bool {
    let trimmed = url.trim();
    trimmed.starts_with("http://") || trimmed.starts_with("https://")
}

pub fn stream_host_allowlist() -> Option<HashSet<String>> {
    let raw = std::env::var("NNPM_STREAM_ALLOWED_HOSTS").ok()?;
    let hosts: HashSet<String> = raw
        .split(',')
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect();
    if hosts.is_empty() {
        None
    } else {
        Some(hosts)
    }
}

pub fn validate_http_stream_url(url: &str) -> AudioResult<()> {
    validate_http_url(url).map_err(|error| AudioError::Playback(error.to_string()))?;
    if let Some(allow) = stream_host_allowlist() {
        let host = http_host(url).ok_or_else(|| {
            AudioError::Playback("Cloud stream URL host is missing".to_string())
        })?;
        if !allow.contains(&host) {
            return Err(AudioError::Playback(
                "Cloud stream URL host is not allowlisted".to_string(),
            ));
        }
    }
    Ok(())
}

pub fn display_stream_path(url: &str) -> PathBuf {
    PathBuf::from(redact_stream_url(url))
}

pub fn is_dsd_location(path: &str) -> bool {
    let without_query = path.split('?').next().unwrap_or(path);
    Path::new(without_query)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("dsf") || ext.eq_ignore_ascii_case("dff"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_urls_and_redacts_query() {
        assert!(validate_http_stream_url("https://127.0.0.1:9000/bucket/a.flac").is_ok());
        assert!(validate_http_stream_url(
            "http://127.0.0.1:9000/bucket/a.flac?X-Amz-Signature=secret"
        )
        .is_ok());
        assert_eq!(
            redact_stream_url("https://cdn.example/a.flac?token=secret"),
            "https://cdn.example/a.flac?[redacted]"
        );
        assert!(validate_http_stream_url("file:///tmp/a.wav").is_err());
        assert!(validate_http_stream_url("http://169.254.169.254/latest").is_err());
    }

    #[test]
    fn optional_host_allowlist_rejects_other_hosts() {
        let previous = std::env::var("NNPM_STREAM_ALLOWED_HOSTS").ok();
        std::env::set_var("NNPM_STREAM_ALLOWED_HOSTS", "cdn.example.test");
        let rejected = validate_http_stream_url("https://other.example.test/a.flac");
        let allowed = validate_http_stream_url("https://cdn.example.test/a.flac");
        match previous {
            Some(value) => std::env::set_var("NNPM_STREAM_ALLOWED_HOSTS", value),
            None => std::env::remove_var("NNPM_STREAM_ALLOWED_HOSTS"),
        }
        assert!(rejected.is_err());
        assert!(allowed.is_ok());
    }

    #[test]
    fn detects_dsd_locations() {
        assert!(is_dsd_location("https://cdn.example/a.dsf?sig=1"));
        assert!(is_dsd_location("C:/music/track.dff"));
        assert!(!is_dsd_location("https://cdn.example/a.flac"));
    }
}
