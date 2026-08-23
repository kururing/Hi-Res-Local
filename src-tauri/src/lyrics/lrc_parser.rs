use regex::Regex;
use std::fs;
use std::path::Path;

use crate::models::lyrics::{LyricsData, LyricsSource, SyncedLyricLine};

/// Parses an LRC string or plain text into a structured [`LyricsData`].
pub fn parse_lrc(content: &str, source: LyricsSource) -> LyricsData {
    let lines: Vec<&str> = content.lines().collect();
    let mut synced_lines: Vec<SyncedLyricLine> = Vec::new();
    let mut offset_ms: i64 = 0;

    let time_tag_regex =
        Regex::new(r"\[(\d{1,2}):(\d{2})(?:(?:\.|:)(\d{2,3}))?\]").expect("Invalid regex");
    let offset_regex = Regex::new(r"\[offset:\s*([+-]?\d+)\s*\]").expect("Invalid regex");

    for line in &lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Check for offset tag
        if let Some(caps) = offset_regex.captures(trimmed) {
            if let Some(m) = caps.get(1) {
                if let Ok(val) = m.as_str().parse::<i64>() {
                    offset_ms = val;
                }
            }
            continue;
        }

        // Check if line contains one or more timestamp tags
        let mut timestamps = Vec::new();
        let mut last_tag_end = 0;

        for caps in time_tag_regex.captures_iter(trimmed) {
            if let (Some(m_min), Some(m_sec)) = (caps.get(1), caps.get(2)) {
                let minutes: u64 = m_min.as_str().parse().unwrap_or(0);
                let seconds: u64 = m_sec.as_str().parse().unwrap_or(0);

                let millis: u64 = if let Some(m_sub) = caps.get(3) {
                    let sub_str = m_sub.as_str();
                    if sub_str.len() == 2 {
                        sub_str.parse::<u64>().unwrap_or(0) * 10
                    } else {
                        sub_str.parse::<u64>().unwrap_or(0)
                    }
                } else {
                    0
                };

                let total_ms = minutes * 60_000 + seconds * 1_000 + millis;
                timestamps.push(total_ms);
            }
            if let Some(m) = caps.get(0) {
                last_tag_end = last_tag_end.max(m.end());
            }
        }

        if !timestamps.is_empty() {
            let text = trimmed[last_tag_end..].trim().to_string();
            for ts in timestamps {
                let adjusted_ts = if offset_ms < 0 {
                    ts.saturating_sub(offset_ms.unsigned_abs())
                } else {
                    ts.saturating_add(offset_ms as u64)
                };

                synced_lines.push(SyncedLyricLine {
                    timestamp_ms: adjusted_ts,
                    text: text.clone(),
                });
            }
        }
    }

    // Sort by timestamp
    synced_lines.sort_by_key(|l| l.timestamp_ms);

    let is_synced = !synced_lines.is_empty();

    LyricsData {
        is_synced,
        lines: synced_lines,
        plain_text: content.to_string(),
        source,
    }
}

pub fn load_lyrics_for_track(
    embedded_lyrics: Option<&str>,
    audio_file_path: &Path,
) -> Option<LyricsData> {
    // 1. Check for external .lrc file next to audio file
    let lrc_path = audio_file_path.with_extension("lrc");
    if lrc_path.is_file() {
        if let Ok(content) = fs::read_to_string(&lrc_path) {
            let parsed = parse_lrc(&content, LyricsSource::LrcFile);
            if parsed.is_synced || !parsed.plain_text.trim().is_empty() {
                return Some(parsed);
            }
        }
    }

    // 2. Check embedded lyrics
    if let Some(lyrics_str) = embedded_lyrics {
        if !lyrics_str.trim().is_empty() {
            return Some(parse_lrc(lyrics_str, LyricsSource::Embedded));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_standard_lrc() {
        let sample = r#"
[ti:Never Gonna Give You Up]
[ar:Rick Astley]
[00:18.50]Never gonna give you up
[00:22.10]Never gonna let you down
[00:26.00]Never gonna run around and desert you
"#;
        let data = parse_lrc(sample, LyricsSource::Embedded);
        assert!(data.is_synced);
        assert_eq!(data.lines.len(), 3);
        assert_eq!(data.lines[0].timestamp_ms, 18500);
        assert_eq!(data.lines[0].text, "Never gonna give you up");
        assert_eq!(data.lines[1].timestamp_ms, 22100);
        assert_eq!(data.lines[2].timestamp_ms, 26000);
    }

    #[test]
    fn test_parse_multi_timestamp_lrc() {
        let sample = r#"
[00:10.00][00:20.00]Chorus line repeated
"#;
        let data = parse_lrc(sample, LyricsSource::LrcFile);
        assert!(data.is_synced);
        assert_eq!(data.lines.len(), 2);
        assert_eq!(data.lines[0].timestamp_ms, 10000);
        assert_eq!(data.lines[0].text, "Chorus line repeated");
        assert_eq!(data.lines[1].timestamp_ms, 20000);
        assert_eq!(data.lines[1].text, "Chorus line repeated");
    }

    #[test]
    fn test_parse_plain_text() {
        let sample = "Just regular lyrics\nwithout timestamps";
        let data = parse_lrc(sample, LyricsSource::Embedded);
        assert!(!data.is_synced);
        assert_eq!(data.lines.len(), 0);
        assert_eq!(data.plain_text, sample);
    }
}
