use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};

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
                    romanized: None,
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
        romanized: None,
    }
}

/// Finds the highest priority companion romanized LRC file beside the given audio path.
/// Priority: `.romanized.lrc` > `.romaji.lrc` > `.romanization.lrc`.
pub fn find_romanized_lrc_path(audio_file_path: &Path) -> Option<PathBuf> {
    let parent = audio_file_path.parent()?;
    let stem = audio_file_path.file_stem()?.to_str()?;

    let candidates = [
        format!("{stem}.romanized.lrc"),
        format!("{stem}.romaji.lrc"),
        format!("{stem}.romanization.lrc"),
    ];

    for candidate in candidates {
        let p = parent.join(candidate);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Matches original synced lyric lines with romanized synced lyric lines by timestamp proximity (<= 1000ms).
pub fn match_romanized_lines(
    original_lines: &[SyncedLyricLine],
    romanized_lines: &[SyncedLyricLine],
) -> Vec<SyncedLyricLine> {
    let mut matched = original_lines.to_vec();
    for orig in &mut matched {
        let best_match = romanized_lines
            .iter()
            .filter(|rom| (orig.timestamp_ms as i64 - rom.timestamp_ms as i64).abs() <= 1000)
            .min_by_key(|rom| (orig.timestamp_ms as i64 - rom.timestamp_ms as i64).abs());

        if let Some(rom) = best_match {
            orig.romanized = Some(rom.text.clone());
        }
    }
    matched
}

/// Loads lyrics for a track, discovering both standard lyrics (embedded or `<stem>.lrc`)
/// and companion romanized lyrics (`<stem>.romanized.lrc`, `<stem>.romaji.lrc`, `<stem>.romanization.lrc`).
pub fn load_lyrics_for_track(
    embedded_lyrics: Option<&str>,
    audio_file_path: &Path,
) -> Option<LyricsData> {
    // 1. Discover original lyrics
    let mut original_lyrics: Option<LyricsData> = None;
    let lrc_path = audio_file_path.with_extension("lrc");
    if lrc_path.is_file() {
        if let Ok(content) = fs::read_to_string(&lrc_path) {
            let parsed = parse_lrc(&content, LyricsSource::LrcFile);
            if parsed.is_synced || !parsed.plain_text.trim().is_empty() {
                original_lyrics = Some(parsed);
            }
        }
    }

    if original_lyrics.is_none() {
        if let Some(lyrics_str) = embedded_lyrics {
            if !lyrics_str.trim().is_empty() {
                original_lyrics = Some(parse_lrc(lyrics_str, LyricsSource::Embedded));
            }
        }
    }

    // 2. Discover companion romanized lyrics
    let mut romanized_lyrics: Option<LyricsData> = None;
    if let Some(rom_path) = find_romanized_lrc_path(audio_file_path) {
        if let Ok(content) = fs::read_to_string(&rom_path) {
            let parsed = parse_lrc(&content, LyricsSource::LrcFile);
            if parsed.is_synced || !parsed.plain_text.trim().is_empty() {
                romanized_lyrics = Some(parsed);
            }
        }
    }

    // 3. Combine original and romanized data
    match (original_lyrics, romanized_lyrics) {
        (Some(mut orig), Some(rom)) => {
            if orig.is_synced && rom.is_synced {
                orig.lines = match_romanized_lines(&orig.lines, &rom.lines);
            }
            orig.romanized = Some(Box::new(rom));
            Some(orig)
        }
        (Some(orig), None) => Some(orig),
        (None, Some(rom)) => {
            // Romanized-only timeline: preserve empty original payload plus the romanized subdata
            Some(LyricsData {
                is_synced: false,
                lines: Vec::new(),
                plain_text: String::new(),
                source: LyricsSource::None,
                romanized: Some(Box::new(rom)),
            })
        }
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

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
        assert!(data.romanized.is_none());
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

    #[test]
    fn test_timestamp_matching_synced() {
        let orig_lines = vec![
            SyncedLyricLine {
                timestamp_ms: 10000,
                text: "夜に駆ける".to_string(),
                romanized: None,
            },
            SyncedLyricLine {
                timestamp_ms: 25000,
                text: "沈むように溶けてゆくように".to_string(),
                romanized: None,
            },
            SyncedLyricLine {
                timestamp_ms: 40000,
                text: "二人だけの空が広がる夜に".to_string(),
                romanized: None,
            },
        ];

        // Romanized lines with slightly shifted timestamps (e.g. ±150ms)
        let rom_lines = vec![
            SyncedLyricLine {
                timestamp_ms: 10100,
                text: "Yoru ni kakeru".to_string(),
                romanized: None,
            },
            SyncedLyricLine {
                timestamp_ms: 24900,
                text: "Shizumu you ni tokete yuku you ni".to_string(),
                romanized: None,
            },
            SyncedLyricLine {
                timestamp_ms: 40050,
                text: "Futari dake no sora ga hirogaru yoru ni".to_string(),
                romanized: None,
            },
        ];

        let matched = match_romanized_lines(&orig_lines, &rom_lines);
        assert_eq!(matched.len(), 3);
        assert_eq!(matched[0].romanized.as_deref(), Some("Yoru ni kakeru"));
        assert_eq!(
            matched[1].romanized.as_deref(),
            Some("Shizumu you ni tokete yuku you ni")
        );
        assert_eq!(
            matched[2].romanized.as_deref(),
            Some("Futari dake no sora ga hirogaru yoru ni")
        );
    }

    #[test]
    fn test_discovery_priority() {
        let temp_dir = std::env::temp_dir().join(format!("lrc_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();

        let audio_path = temp_dir.join("track.flac");
        let lrc_romanized = temp_dir.join("track.romanized.lrc");
        let lrc_romaji = temp_dir.join("track.romaji.lrc");
        let lrc_romanization = temp_dir.join("track.romanization.lrc");

        File::create(&audio_path).unwrap();

        // 1. All 3 exist -> choose .romanized.lrc
        {
            let mut f1 = File::create(&lrc_romanized).unwrap();
            f1.write_all(b"[00:05.00]Romanized Winner").unwrap();

            let mut f2 = File::create(&lrc_romaji).unwrap();
            f2.write_all(b"[00:05.00]Romaji").unwrap();

            let mut f3 = File::create(&lrc_romanization).unwrap();
            f3.write_all(b"[00:05.00]Romanization").unwrap();
        }

        let discovered = find_romanized_lrc_path(&audio_path).unwrap();
        assert_eq!(discovered, lrc_romanized);

        // 2. Remove .romanized.lrc -> choose .romaji.lrc
        fs::remove_file(&lrc_romanized).unwrap();
        let discovered2 = find_romanized_lrc_path(&audio_path).unwrap();
        assert_eq!(discovered2, lrc_romaji);

        // 3. Remove .romaji.lrc -> choose .romanization.lrc
        fs::remove_file(&lrc_romaji).unwrap();
        let discovered3 = find_romanized_lrc_path(&audio_path).unwrap();
        assert_eq!(discovered3, lrc_romanization);

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_absent_romanized_files() {
        let temp_dir = std::env::temp_dir().join(format!("lrc_absent_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();

        let audio_path = temp_dir.join("song.mp3");
        let lrc_path = temp_dir.join("song.lrc");

        File::create(&audio_path).unwrap();
        {
            let mut f = File::create(&lrc_path).unwrap();
            f.write_all(b"[00:10.00]Original Only").unwrap();
        }

        let loaded = load_lyrics_for_track(None, &audio_path).unwrap();
        assert!(loaded.is_synced);
        assert_eq!(loaded.lines.len(), 1);
        assert_eq!(loaded.lines[0].text, "Original Only");
        assert!(loaded.lines[0].romanized.is_none());
        assert!(loaded.romanized.is_none());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_plain_and_synced_combinations() {
        let temp_dir = std::env::temp_dir().join(format!("lrc_combos_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();

        let audio_path = temp_dir.join("combo.mp3");
        let lrc_path = temp_dir.join("combo.lrc");
        let rom_path = temp_dir.join("combo.romanized.lrc");

        File::create(&audio_path).unwrap();

        // 1. Synced Original + Plain Romanized
        {
            let mut f1 = File::create(&lrc_path).unwrap();
            f1.write_all(b"[00:10.00]Synced Japanese Line").unwrap();

            let mut f2 = File::create(&rom_path).unwrap();
            f2.write_all(b"Plain text romaji without time tags")
                .unwrap();
        }

        let loaded1 = load_lyrics_for_track(None, &audio_path).unwrap();
        assert!(loaded1.is_synced);
        assert_eq!(loaded1.lines[0].text, "Synced Japanese Line");
        assert!(loaded1.romanized.is_some());
        let rom1 = loaded1.romanized.unwrap();
        assert!(!rom1.is_synced);
        assert_eq!(rom1.plain_text, "Plain text romaji without time tags");

        // 2. Romanized only (no original .lrc or embedded)
        fs::remove_file(&lrc_path).unwrap();
        {
            let mut f2 = File::create(&rom_path).unwrap();
            f2.write_all(b"[00:15.00]Romaji Alone").unwrap();
        }

        let loaded2 = load_lyrics_for_track(None, &audio_path).unwrap();
        assert!(!loaded2.is_synced);
        assert_eq!(loaded2.lines.len(), 0);
        assert_eq!(loaded2.plain_text, "");
        assert!(loaded2.romanized.is_some());
        let rom2 = loaded2.romanized.unwrap();
        assert!(rom2.is_synced);
        assert_eq!(rom2.lines.len(), 1);
        assert_eq!(rom2.lines[0].text, "Romaji Alone");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
