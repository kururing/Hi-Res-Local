use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::error::{CoreError, CoreResult};

/// Readable, seekable media input: local file, HTTP range, or in-memory bytes.
pub enum MediaSource {
    File {
        path: PathBuf,
        file: File,
        len: u64,
    },
    Memory {
        label: String,
        cursor: Cursor<Vec<u8>>,
    },
    #[cfg(not(target_arch = "wasm32"))]
    Http(HttpRangeSource),
}

/// HTTP(S) source that prefers `Range` GETs so a signed URL is not slurped whole.
#[cfg(not(target_arch = "wasm32"))]
pub struct HttpRangeSource {
    url: String,
    pos: u64,
    len: u64,
    cache_start: u64,
    cache: Vec<u8>,
}

#[cfg(not(target_arch = "wasm32"))]
const HTTP_RANGE_WINDOW: u64 = 256 * 1024;

impl MediaSource {
    pub fn open_file(path: impl AsRef<Path>) -> CoreResult<Self> {
        let path = path.as_ref().to_path_buf();
        let file = File::open(&path).map_err(|source| CoreError::io(Some(path.clone()), source))?;
        let len = file
            .metadata()
            .map_err(|source| CoreError::io(Some(path.clone()), source))?
            .len();
        Ok(Self::File { path, file, len })
    }

    pub fn from_bytes(label: impl Into<String>, bytes: Vec<u8>) -> Self {
        Self::Memory {
            label: label.into(),
            cursor: Cursor::new(bytes),
        }
    }

    /// Fetch an HTTP(S) URL. Uses Range when the server answers 206.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn open_http(url: &str) -> CoreResult<Self> {
        validate_http_url(url)?;
        match probe_http(url)? {
            HttpProbe::Ranged { len, head } => Ok(Self::Http(HttpRangeSource {
                url: url.to_string(),
                pos: 0,
                len,
                cache_start: 0,
                cache: head,
            })),
            HttpProbe::Buffered(bytes) => Ok(Self::from_bytes(redact_url(url), bytes)),
        }
    }

    pub fn label(&self) -> String {
        match self {
            Self::File { path, .. } => path.display().to_string(),
            Self::Memory { label, .. } => label.clone(),
            #[cfg(not(target_arch = "wasm32"))]
            Self::Http(http) => redact_url(&http.url),
        }
    }

    pub fn len(&self) -> u64 {
        match self {
            Self::File { len, .. } => *len,
            Self::Memory { cursor, .. } => cursor.get_ref().len() as u64,
            #[cfg(not(target_arch = "wasm32"))]
            Self::Http(http) => http.len,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn read_all(&mut self) -> CoreResult<Vec<u8>> {
        self.seek(SeekFrom::Start(0))?;
        let mut buf = Vec::new();
        self.read_to_end(&mut buf)?;
        Ok(buf)
    }

    pub fn path(&self) -> Option<&Path> {
        match self {
            Self::File { path, .. } => Some(path),
            Self::Memory { .. } => None,
            #[cfg(not(target_arch = "wasm32"))]
            Self::Http(_) => None,
        }
    }

    /// Peek `DSD ` / `FRM8` without consuming the stream.
    pub fn looks_like_dsd(&mut self) -> bool {
        let Ok(start) = self.seek(SeekFrom::Current(0)) else {
            return false;
        };
        let mut magic = [0u8; 4];
        let n = self.read(&mut magic).unwrap_or(0);
        let _ = self.seek(SeekFrom::Start(start));
        n >= 4 && (&magic == b"DSD " || &magic == b"FRM8")
    }
}

impl Read for MediaSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::File { file, .. } => file.read(buf),
            Self::Memory { cursor, .. } => cursor.read(buf),
            #[cfg(not(target_arch = "wasm32"))]
            Self::Http(http) => http.read(buf),
        }
    }
}

impl Seek for MediaSource {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        match self {
            Self::File { file, .. } => file.seek(pos),
            Self::Memory { cursor, .. } => cursor.seek(pos),
            #[cfg(not(target_arch = "wasm32"))]
            Self::Http(http) => http.seek(pos),
        }
    }
}

/// Max bytes slurped when the server ignores Range and answers 200.
pub const MAX_HTTP_BUFFERED_BYTES: u64 = 256 * 1024 * 1024;

pub fn validate_http_url(url: &str) -> CoreResult<()> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(CoreError::InvalidSource(
            "only http:// and https:// URLs are allowed".into(),
        ));
    }
    if lower.starts_with("file:") {
        return Err(CoreError::InvalidSource("file:// URLs are rejected".into()));
    }
    let host = http_host(trimmed).ok_or_else(|| {
        CoreError::InvalidSource("HTTP URL host is missing or invalid".into())
    })?;
    if http_authority_has_userinfo(trimmed) {
        return Err(CoreError::InvalidSource(
            "HTTP URLs with userinfo are rejected".into(),
        ));
    }
    if is_blocked_http_host(&host) {
        return Err(CoreError::InvalidSource(format!(
            "HTTP host {host} is not allowed"
        )));
    }
    Ok(())
}

/// Hostname without brackets or port (`127.0.0.1`, `cdn.example`).
pub fn http_host(url: &str) -> Option<String> {
    let rest = url.trim().split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let hostport = authority.rsplit_once('@').map(|(_, host)| host).unwrap_or(authority);
    let host = if let Some(inner) = hostport.strip_prefix('[') {
        inner.split(']').next()?
    } else {
        hostport.rsplit_once(':').map(|(host, port)| {
            if port.chars().all(|c| c.is_ascii_digit()) {
                host
            } else {
                hostport
            }
        }).unwrap_or(hostport)
    };
    let host = host.trim().trim_matches('"').to_ascii_lowercase();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn http_authority_has_userinfo(url: &str) -> bool {
    let Some((_, rest)) = url.trim().split_once("://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    authority.contains('@')
}

pub fn is_blocked_http_host(host: &str) -> bool {
    let host = host.trim().trim_matches('[').trim_end_matches(']').to_ascii_lowercase();
    matches!(
        host.as_str(),
        "169.254.169.254"
            | "metadata.google.internal"
            | "metadata.internal"
            | "0.0.0.0"
            | "::"
            | "0:0:0:0:0:0:0:0"
    ) || host.starts_with("169.254.")
        || host.starts_with("fe80:")
}

pub fn redact_url(url: &str) -> String {
    match url.split_once('?') {
        Some((head, _)) => format!("{head}?[redacted]"),
        None => url.to_string(),
    }
}

/// Parse the total size from `Content-Range: bytes start-end/total`.
pub fn parse_content_range_total(header: Option<&str>) -> Option<u64> {
    let header = header?;
    let total = header.rsplit_once('/')?.1.trim();
    if total == "*" {
        return None;
    }
    total.parse().ok()
}

#[cfg(not(target_arch = "wasm32"))]
enum HttpProbe {
    Ranged { len: u64, head: Vec<u8> },
    Buffered(Vec<u8>),
}

#[cfg(not(target_arch = "wasm32"))]
fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(std::time::Duration::from_secs(60))
        .build()
}

#[cfg(not(target_arch = "wasm32"))]
fn declared_content_length(response: &ureq::Response) -> Option<u64> {
    response.header("Content-Length")?.trim().parse().ok()
}

#[cfg(not(target_arch = "wasm32"))]
fn reject_oversize(len: Option<u64>, url: &str) -> CoreResult<()> {
    if len.is_some_and(|n| n > MAX_HTTP_BUFFERED_BYTES) {
        return Err(CoreError::Http(format!(
            "{}: body exceeds the {} byte playback limit",
            redact_url(url),
            MAX_HTTP_BUFFERED_BYTES
        )));
    }
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
fn read_limited(reader: impl Read, max_bytes: u64, url: &str) -> CoreResult<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 64 * 1024];
    let mut reader = reader;
    let mut total = 0u64;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| CoreError::Http(format!("{}: {e}", redact_url(url))))?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > max_bytes {
            return Err(CoreError::Http(format!(
                "{}: body exceeds the {max_bytes} byte playback limit",
                redact_url(url)
            )));
        }
        bytes.extend_from_slice(&buf[..n]);
    }
    Ok(bytes)
}

#[cfg(not(target_arch = "wasm32"))]
fn probe_http(url: &str) -> CoreResult<HttpProbe> {
    let response = http_agent()
        .get(url)
        .set("Range", "bytes=0-255")
        .call()
        .map_err(|e| CoreError::Http(format!("{}: {e}", redact_url(url))))?;
    let status = response.status();
    if status == 206 {
        let Some(len) = parse_content_range_total(response.header("Content-Range")) else {
            return fetch_url_bytes(url).map(HttpProbe::Buffered);
        };
        let head = read_limited(response.into_reader(), 4096, url)?;
        return Ok(HttpProbe::Ranged { len, head });
    }
    if status == 200 {
        reject_oversize(declared_content_length(&response), url)?;
        let bytes = read_limited(response.into_reader(), MAX_HTTP_BUFFERED_BYTES, url)?;
        return Ok(HttpProbe::Buffered(bytes));
    }
    Err(CoreError::Http(format!(
        "{}: unexpected HTTP {status}",
        redact_url(url)
    )))
}

#[cfg(not(target_arch = "wasm32"))]
fn fetch_url_bytes(url: &str) -> CoreResult<Vec<u8>> {
    let response = http_agent()
        .get(url)
        .call()
        .map_err(|e| CoreError::Http(format!("{}: {e}", redact_url(url))))?;
    reject_oversize(declared_content_length(&response), url)?;
    read_limited(response.into_reader(), MAX_HTTP_BUFFERED_BYTES, url)
}

#[cfg(not(target_arch = "wasm32"))]
fn fetch_range(url: &str, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    let response = http_agent()
        .get(url)
        .set("Range", &format!("bytes={start}-{end}"))
        .call()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let status = response.status();
    if status == 206 {
        return read_limited(response.into_reader(), HTTP_RANGE_WINDOW.saturating_add(1024), url)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()));
    }
    if status == 200 {
        reject_oversize(declared_content_length(&response), url)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
        let bytes = read_limited(response.into_reader(), MAX_HTTP_BUFFERED_BYTES, url)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        let start = start as usize;
        let end = (end as usize).saturating_add(1).min(bytes.len());
        if start >= bytes.len() {
            return Ok(Vec::new());
        }
        return Ok(bytes[start..end].to_vec());
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::Other,
        format!("HTTP {status} for range {start}-{end}"),
    ))
}

#[cfg(not(target_arch = "wasm32"))]
impl HttpRangeSource {
    fn fill_cache(&mut self, start: u64) -> std::io::Result<()> {
        if start >= self.len {
            self.cache.clear();
            self.cache_start = start;
            return Ok(());
        }
        let end = start
            .saturating_add(HTTP_RANGE_WINDOW.saturating_sub(1))
            .min(self.len.saturating_sub(1));
        self.cache = fetch_range(&self.url, start, end)?;
        self.cache_start = start;
        Ok(())
    }

    fn cache_contains(&self, pos: u64) -> bool {
        !self.cache.is_empty()
            && pos >= self.cache_start
            && pos < self.cache_start + self.cache.len() as u64
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Read for HttpRangeSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.pos >= self.len || buf.is_empty() {
            return Ok(0);
        }
        if !self.cache_contains(self.pos) {
            self.fill_cache(self.pos)?;
        }
        if !self.cache_contains(self.pos) {
            return Ok(0);
        }
        let offset = (self.pos - self.cache_start) as usize;
        let n = (self.cache.len() - offset)
            .min(buf.len())
            .min((self.len - self.pos) as usize);
        buf[..n].copy_from_slice(&self.cache[offset..offset + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Seek for HttpRangeSource {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let next = match pos {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::Current(n) => self.pos as i128 + i128::from(n),
            SeekFrom::End(n) => self.len as i128 + i128::from(n),
        };
        if next < 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "seek before start of HTTP source",
            ));
        }
        self.pos = next as u64;
        Ok(self.pos)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl symphonia::core::io::MediaSource for HttpRangeSource {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.len)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_file_urls_and_redacts_query() {
        assert!(validate_http_url("file:///tmp/a.wav").is_err());
        assert!(validate_http_url("https://cdn.example/a.flac?token=secret").is_ok());
        assert!(validate_http_url("https://127.0.0.1:9000/bucket/a.flac").is_ok());
        assert!(validate_http_url("http://user:pass@cdn.example/a.flac").is_err());
        assert!(validate_http_url("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_http_url("http://169.254.1.1/x").is_err());
        assert!(validate_http_url("http://[fe80::1]/a.flac").is_err());
        assert!(validate_http_url("http://metadata.google.internal/").is_err());
        assert_eq!(http_host("https://cdn.example:443/a.flac?x=1").as_deref(), Some("cdn.example"));
        assert_eq!(
            http_host("http://user:pass@cdn.example/a.flac").as_deref(),
            Some("cdn.example")
        );
        assert_eq!(
            redact_url("https://cdn.example/a.flac?token=secret"),
            "https://cdn.example/a.flac?[redacted]"
        );
    }

    #[test]
    fn parse_content_range_total_reads_size() {
        assert_eq!(
            parse_content_range_total(Some("bytes 0-255/12345")),
            Some(12_345)
        );
        assert_eq!(parse_content_range_total(Some("bytes 0-255/*")), None);
        assert_eq!(parse_content_range_total(None), None);
    }

    #[test]
    fn memory_source_detects_dsd_magic() {
        let mut source = MediaSource::from_bytes("x.dsf", b"DSD hello".to_vec());
        assert!(source.looks_like_dsd());
        let mut pcm = MediaSource::from_bytes("x.wav", b"RIFF".to_vec());
        assert!(!pcm.looks_like_dsd());
        assert_eq!(pcm.seek(SeekFrom::Current(0)).unwrap(), 0);
    }
}
