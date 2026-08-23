use sha2::{Digest, Sha256};
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

use crate::models::track::Track;

/// Normalizes a string for deduplication (removes diacritics, punctuation, collapses whitespace).
pub fn normalize_string(input: &str) -> String {
    let mut normalized = String::new();
    // 1. Decompose unicode characters (e.g. 'é' -> 'e' + combining acute)
    for c in input.nfd() {
        // Strip combining marks
        if !unicode_normalization::is_combining_mark(c) {
            if c.is_alphanumeric() || c == ' ' {
                normalized.push(c.to_ascii_lowercase());
            }
        }
    }

    // 2. Collapse multi-whitespace
    let words: Vec<&str> = normalized.split_whitespace().collect();
    words.join(" ")
}

pub fn compute_duplicate_key(title: &str, artist: &str) -> String {
    let norm_title = normalize_string(title);
    let norm_artist = normalize_string(artist);
    format!("{}::{}", norm_title, norm_artist)
}

fn format_quality_rank(format: &str) -> u32 {
    match format.to_ascii_lowercase().as_str() {
        "flac" | "alac" | "wav" | "aiff" | "aif" | "ape" => 100,
        "aac" | "m4a" => 80,
        "mp3" => 70,
        "opus" | "ogg" | "oga" => 65,
        "wma" => 50,
        _ => 40,
    }
}

/// Evaluates a list of tracks and assigns duplicate group IDs and `is_primary` flags.
pub fn detect_and_assign_duplicates(tracks: &mut [Track]) {
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();

    for (idx, track) in tracks.iter().enumerate() {
        if track.is_corrupt {
            continue;
        }
        let key = compute_duplicate_key(&track.title, &track.artist);
        if !key.is_empty() && key != "::" {
            groups.entry(key).or_default().push(idx);
        }
    }

    for (key, indices) in groups {
        if indices.len() > 1 {
            let mut hasher = Sha256::new();
            hasher.update(key.as_bytes());
            let group_id = format!("dup_{:x}", hasher.finalize())[0..16].to_string();

            // Find best track by quality rank, bitrate, sample_rate, and file size
            let mut best_idx = indices[0];
            let mut best_score = track_score(&tracks[best_idx]);

            for &idx in &indices[1..] {
                let score = track_score(&tracks[idx]);
                if score > best_score {
                    best_score = score;
                    best_idx = idx;
                }
            }

            for &idx in &indices {
                tracks[idx].duplicate_group_id = Some(group_id.clone());
                tracks[idx].is_primary = idx == best_idx;
            }
        } else {
            let idx = indices[0];
            tracks[idx].duplicate_group_id = None;
            tracks[idx].is_primary = true;
        }
    }
}

fn track_score(track: &Track) -> (u32, u32, u32, u64) {
    (
        format_quality_rank(&track.format),
        track.bitrate.unwrap_or(0),
        track.sample_rate.unwrap_or(0),
        track.file_size,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_string() {
        assert_eq!(normalize_string("  Hello,  World!  "), "hello world");
        assert_eq!(
            normalize_string("Đường Một Chiều - Huỳnh Tú"),
            "duong mot chieu huynh tu"
        );
        assert_eq!(normalize_string("Café del Mar (Live)"), "cafe del mar live");
    }

    #[test]
    fn test_duplicate_key_equality() {
        let k1 = compute_duplicate_key("Hotel California", "Eagles");
        let k2 = compute_duplicate_key("hotel california ", "Eagles ");
        let k3 = compute_duplicate_key("Hotel California (Remastered)", "Eagles");
        assert_eq!(k1, k2);
        assert_ne!(k1, k3);
    }
}
