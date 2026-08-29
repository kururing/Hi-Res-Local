use serde::Deserialize;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tauri::State;
use unicode_normalization::UnicodeNormalization;

use crate::db::queries_tracks::get_track_by_id;
use crate::lyrics::lrc_parser::{load_lyrics_for_track, parse_lrc};
use crate::models::lyrics::{LyricsData, LyricsSource};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct LrclibResponse {
    #[serde(default)]
    id: u64,
    #[serde(rename = "trackName", default)]
    track_name: String,
    #[serde(rename = "artistName", default)]
    artist_name: String,
    #[serde(rename = "albumName", default)]
    album_name: String,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    instrumental: Option<bool>,
}

fn normalized_match_text(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn text_relation_score(candidate: &str, expected: &str, exact: i32, contains: i32) -> i32 {
    let candidate = normalized_match_text(candidate);
    let expected = normalized_match_text(expected);
    if candidate.is_empty() || expected.is_empty() {
        return 0;
    }
    if candidate == expected {
        exact
    } else if candidate.contains(&expected) || expected.contains(&candidate) {
        contains
    } else {
        0
    }
}

fn version_markers(value: &str) -> Vec<&'static str> {
    let normalized: String = value.nfkc().flat_map(char::to_lowercase).collect();
    let words: Vec<&str> = normalized
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    let mut markers = Vec::new();
    for (word, marker) in [
        ("instrumental", "instrumental"),
        ("karaoke", "karaoke"),
        ("acoustic", "acoustic"),
        ("remix", "remix"),
        ("live", "live"),
    ] {
        if words.contains(&word) {
            markers.push(marker);
        }
    }
    if words.iter().any(|word| word.starts_with("remaster")) {
        markers.push("remaster");
    }
    for (language, marker) in [
        ("japanese", "japanese"),
        ("korean", "korean"),
        ("english", "english"),
    ] {
        if words
            .windows(2)
            .any(|pair| pair[0] == language && (pair[1] == "version" || pair[1].starts_with("ver")))
        {
            markers.push(marker);
        }
    }
    markers
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LyricsScript {
    Hangul,
    Kana,
    Han,
    Cyrillic,
    Arabic,
}

fn dominant_lyrics_script(value: &str) -> Option<LyricsScript> {
    let mut counts = [0_u32; 5];
    for character in value.chars() {
        let code = character as u32;
        if (0xAC00..=0xD7AF).contains(&code) || (0x1100..=0x11FF).contains(&code) {
            counts[0] += 1;
        } else if (0x3040..=0x30FF).contains(&code) || (0x31F0..=0x31FF).contains(&code) {
            counts[1] += 1;
        } else if (0x3400..=0x4DBF).contains(&code) || (0x4E00..=0x9FFF).contains(&code) {
            counts[2] += 1;
        } else if (0x0400..=0x052F).contains(&code) {
            counts[3] += 1;
        } else if (0x0600..=0x06FF).contains(&code) {
            counts[4] += 1;
        }
    }
    let (index, count) = counts
        .into_iter()
        .enumerate()
        .max_by_key(|(_, count)| *count)?;
    if count < 3 {
        return None;
    }
    Some(match index {
        0 => LyricsScript::Hangul,
        1 => LyricsScript::Kana,
        2 => LyricsScript::Han,
        3 => LyricsScript::Cyrillic,
        _ => LyricsScript::Arabic,
    })
}

fn expected_lyrics_script(
    title: &str,
    artist: &str,
    album: &str,
    genre: Option<&str>,
) -> Option<LyricsScript> {
    let metadata = format!("{title} {artist} {album}");
    if let Some(script) = dominant_lyrics_script(&metadata) {
        return Some(script);
    }

    let normalized_genre: String = genre
        .unwrap_or_default()
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect();
    if normalized_genre.contains("kpop") || normalized_genre.contains("korean") {
        Some(LyricsScript::Hangul)
    } else if normalized_genre.contains("jpop") || normalized_genre.contains("japanese") {
        Some(LyricsScript::Kana)
    } else if normalized_genre.contains("cpop")
        || normalized_genre.contains("chinese")
        || normalized_genre.contains("mandopop")
        || normalized_genre.contains("cantopop")
    {
        Some(LyricsScript::Han)
    } else {
        None
    }
}

fn candidate_lyrics_text(candidate: &LrclibResponse) -> &str {
    candidate
        .synced_lyrics
        .as_deref()
        .or(candidate.plain_lyrics.as_deref())
        .unwrap_or_default()
}

fn lrclib_candidate_score(
    candidate: &LrclibResponse,
    title: &str,
    artist: &str,
    album: &str,
    genre: Option<&str>,
    duration_secs: f64,
) -> Option<i32> {
    let title_score = text_relation_score(&candidate.track_name, title, 50, 34);
    let artist_score = text_relation_score(&candidate.artist_name, artist, 45, 24);
    if title_score == 0 || artist_score == 0 {
        return None;
    }

    let mut score = title_score + artist_score;
    if !album.trim().is_empty() && album != "Unknown Album" {
        score += text_relation_score(&candidate.album_name, album, 42, 24);
    }

    if let Some(candidate_duration) = candidate.duration {
        let difference = (candidate_duration - duration_secs).abs();
        score += if difference <= 1.0 {
            36
        } else if difference <= 2.0 {
            30
        } else if difference <= 5.0 {
            14
        } else if difference <= 10.0 {
            2
        } else {
            -30
        };
    }

    let expected_markers = version_markers(&format!("{title} {album}"));
    let candidate_markers = version_markers(&format!(
        "{} {}",
        candidate.track_name, candidate.album_name
    ));
    for _marker in candidate_markers
        .iter()
        .filter(|marker| !expected_markers.contains(marker))
    {
        score -= 45;
    }
    for _marker in expected_markers
        .iter()
        .filter(|marker| !candidate_markers.contains(marker))
    {
        score -= 30;
    }
    if candidate.instrumental.unwrap_or(false) && !expected_markers.contains(&"instrumental") {
        score -= 60;
    }

    let metadata_script = expected_lyrics_script(title, artist, album, genre)
        .or_else(|| dominant_lyrics_script(&candidate.track_name));
    let lyric_script = dominant_lyrics_script(candidate_lyrics_text(candidate));
    if let (Some(metadata_script), Some(lyric_script)) = (metadata_script, lyric_script) {
        score += if metadata_script == lyric_script {
            14
        } else {
            -35
        };
    }

    if candidate
        .synced_lyrics
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        score += 4;
    }
    Some(score)
}

fn select_best_lrclib_candidate(
    candidates: Vec<LrclibResponse>,
    title: &str,
    artist: &str,
    album: &str,
    genre: Option<&str>,
    duration_secs: f64,
) -> Option<LrclibResponse> {
    candidates
        .into_iter()
        .max_by_key(|candidate| {
            (
                lrclib_candidate_score(candidate, title, artist, album, genre, duration_secs)
                    .unwrap_or(i32::MIN),
                std::cmp::Reverse(candidate.id),
            )
        })
        .filter(|candidate| {
            lrclib_candidate_score(candidate, title, artist, album, genre, duration_secs)
                .is_some_and(|score| score >= 70)
        })
}

#[tauri::command]
pub async fn get_track_lyrics(
    track_id: String,
    state: State<'_, AppState>,
) -> Result<Option<LyricsData>, String> {
    let track = {
        let conn = state.db.lock();
        get_track_by_id(&conn, &track_id).map_err(|e| e.to_string())?
    };

    if let Some(t) = track {
        let audio_path = Path::new(&t.path);
        let lyrics = load_lyrics_for_track(t.lyrics.as_deref(), audio_path);
        Ok(lyrics)
    } else {
        Ok(None)
    }
}

/// Fetches lyrics from the free LRCLIB community API.
#[tauri::command]
pub async fn fetch_lrclib_lyrics(
    track_id: String,
    state: State<'_, AppState>,
) -> Result<Option<LyricsData>, String> {
    let track = {
        let conn = state.db.lock();
        get_track_by_id(&conn, &track_id).map_err(|e| e.to_string())?
    };
    let Some(track) = track else {
        return Ok(None);
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Nghe Nhac Pro Max/2.0 (local music player)")
        .build()
        .map_err(|e| format!("Could not initialize LRCLIB client: {e}"))?;
    let duration_secs = track.duration_ms as f64 / 1000.0;
    let query = [
        ("track_name", track.title.as_str()),
        ("artist_name", track.artist.as_str()),
    ];

    // `/api/get` makes an opaque single-result choice and can prefer a translated
    // release with the same English title. Search all plausible records instead,
    // then rank them against the complete local metadata.
    let response = client
        .get("https://lrclib.net/api/search")
        .query(&query)
        .send()
        .await
        .map_err(|e| format!("LRCLIB request failed: {e}"))?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let candidates = response
        .json::<Vec<LrclibResponse>>()
        .await
        .map_err(|e| format!("Invalid LRCLIB response: {e}"))?;
    let Some(payload) = select_best_lrclib_candidate(
        candidates,
        &track.title,
        &track.artist,
        &track.album,
        track.genre.as_deref(),
        duration_secs,
    ) else {
        return Ok(None);
    };

    if payload.instrumental.unwrap_or(false) {
        return Ok(Some(LyricsData {
            is_synced: false,
            lines: Vec::new(),
            plain_text: "[Instrumental]".to_string(),
            source: LyricsSource::Lrclib,
            romanized: None,
        }));
    }

    if let Some(synced) = payload
        .synced_lyrics
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(Some(parse_lrc(&synced, LyricsSource::Lrclib)));
    }

    let Some(plain_text) = payload
        .plain_lyrics
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    Ok(Some(LyricsData {
        is_synced: false,
        lines: Vec::new(),
        plain_text,
        source: LyricsSource::Lrclib,
        romanized: None,
    }))
}

#[tauri::command]
pub async fn parse_lrc_content(content: String) -> Result<LyricsData, String> {
    Ok(parse_lrc(&content, LyricsSource::Embedded))
}

#[tauri::command]
pub async fn save_romanized_lyrics(
    track_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<LyricsData, String> {
    if content.trim().is_empty() {
        return Err("Romanized lyrics file is empty".to_string());
    }

    let track = {
        let conn = state.db.lock();
        get_track_by_id(&conn, &track_id).map_err(|e| e.to_string())?
    }
    .ok_or_else(|| "Track not found".to_string())?;

    let audio_path = Path::new(&track.path);
    let parent = audio_path
        .parent()
        .ok_or_else(|| "Track path has no parent directory".to_string())?;
    let stem = audio_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Track filename is invalid".to_string())?;
    let romanized_path = parent.join(format!("{stem}.romanized.lrc"));

    fs::write(&romanized_path, content.as_bytes())
        .map_err(|e| format!("Could not save Romanized lyrics: {e}"))?;

    load_lyrics_for_track(track.lyrics.as_deref(), audio_path)
        .ok_or_else(|| "Could not reload Romanized lyrics".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(
        id: u64,
        track_name: &str,
        artist_name: &str,
        album_name: &str,
        duration: f64,
        lyrics: &str,
    ) -> LrclibResponse {
        LrclibResponse {
            id,
            track_name: track_name.to_string(),
            artist_name: artist_name.to_string(),
            album_name: album_name.to_string(),
            duration: Some(duration),
            plain_lyrics: Some(lyrics.to_string()),
            synced_lyrics: Some(format!("[00:01.00]{lyrics}")),
            instrumental: Some(false),
        }
    }

    #[test]
    fn lrclib_ranking_prefers_matching_album_over_translated_exact_title() {
        let korean = candidate(
            1,
            "고민보다 Go (Go Go)",
            "BTS",
            "LOVE YOURSELF 結 'Answer'",
            235.0,
            "하루아침에 전부 탕진 달려 달려",
        );
        let japanese = candidate(
            2,
            "Go Go",
            "BTS",
            "Musicas",
            236.0,
            "全て無くすまで まだまだ 走り稼ぐだけ",
        );

        let selected = select_best_lrclib_candidate(
            vec![japanese, korean],
            "Go Go",
            "BTS",
            "Love Yourself 結 'Answer'",
            None,
            235.0,
        )
        .expect("a matching Korean result");

        assert_eq!(selected.id, 1);
    }

    #[test]
    fn lrclib_ranking_penalizes_lyrics_incompatible_with_native_title_script() {
        let korean = candidate(
            10,
            "고민보다 Go",
            "BTS",
            "LOVE YOURSELF 承 'Her'",
            235.0,
            "하루아침에 전부 탕진 달려 달려",
        );
        let mislabeled_japanese = candidate(
            11,
            "고민보다 Go",
            "BTS",
            "LOVE YOURSELF 承 'Her'",
            235.0,
            "全て無くすまで まだまだ 走り稼ぐだけ",
        );

        let selected = select_best_lrclib_candidate(
            vec![mislabeled_japanese, korean],
            "고민보다 Go",
            "BTS",
            "LOVE YOURSELF 承 'Her'",
            None,
            235.0,
        )
        .expect("a script-compatible result");

        assert_eq!(selected.id, 10);
    }

    #[test]
    fn lrclib_ranking_rejects_unrelated_search_results() {
        let unrelated = candidate(
            20,
            "Go Go",
            "Different Artist",
            "Different Album",
            235.0,
            "Some lyrics",
        );

        assert!(select_best_lrclib_candidate(
            vec![unrelated],
            "Go Go",
            "BTS",
            "LOVE YOURSELF 結 'Answer'",
            None,
            235.0,
        )
        .is_none());
    }

    #[test]
    fn lrclib_ranking_uses_genre_to_reject_wrong_lyrics_script() {
        let chinese_cache_poison = candidate(
            91,
            "Boy In Luv",
            "BTS",
            "Proof",
            231.0,
            "放不下 誰在尷尬 而我自問自答 練習牽掛",
        );
        let korean_original = candidate(
            92,
            "Boy In Luv",
            "BTS",
            "Skool Luv Affair Special Addition",
            231.0,
            "되고파 너의 오빠 너의 사랑이 난 너무 고파",
        );

        let selected = select_best_lrclib_candidate(
            vec![chinese_cache_poison, korean_original],
            "Boy In Luv",
            "BTS",
            "Proof",
            Some("K-Pop"),
            231.0,
        )
        .expect("the original Korean lyrics");

        assert_eq!(selected.id, 92);
    }

    #[test]
    fn version_markers_only_match_whole_words() {
        assert!(version_markers("Stay Alive").is_empty());
        assert_eq!(
            version_markers("Song (Live Remastered)"),
            vec!["live", "remaster"]
        );
        assert_eq!(version_markers("Song - Japanese Ver."), vec!["japanese"]);
    }
}
