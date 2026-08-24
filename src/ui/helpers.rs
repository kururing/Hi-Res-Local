//! Pure helper functions for formatting, filtering, and data aggregation in the UI.

use crate::app::{LoopMode, Track, TrackId};
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

/// Formats a duration into a standard time string (e.g., "03:45" or "1:12:05").
pub fn format_duration(duration: Duration) -> String {
    let total_secs = duration.as_secs();
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;

    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, seconds)
    } else {
        format!("{:02}:{:02}", minutes, seconds)
    }
}

/// Formats total seconds into a human-friendly duration string (e.g. "2h 15m" or "45m 12s").
pub fn format_duration_human(total_secs: u64) -> String {
    let days = total_secs / 86400;
    let hours = (total_secs % 86400) / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;

    if days > 0 {
        format!("{}d {}h {}m", days, hours, minutes)
    } else if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else if minutes > 0 {
        format!("{}m {:02}s", minutes, seconds)
    } else {
        format!("{}s", seconds)
    }
}

/// Formats sample rate into kHz representation (e.g. "44.1 kHz", "96 kHz").
/// Falls back to "N/A" if missing.
pub fn format_sample_rate(sample_rate: Option<u32>) -> String {
    match sample_rate {
        Some(sr) => {
            let khz = sr as f32 / 1000.0;
            if (khz.fract() - 0.0).abs() < 0.01 {
                format!("{:.0} kHz", khz)
            } else {
                format!("{:.1} kHz", khz)
            }
        }
        None => "N/A".to_string(),
    }
}

/// Formats bit depth into standard string representation (e.g. "16-bit", "24-bit").
/// Falls back to "N/A" if missing.
pub fn format_bit_depth(bit_depth: Option<u8>) -> String {
    match bit_depth {
        Some(bd) if bd > 0 => format!("{}-bit", bd),
        _ => "N/A".to_string(),
    }
}

/// Formats sample rate and bit depth together from metadata (e.g. "44.1 kHz / 16-bit", "96 kHz / 24-bit", "44.1 kHz / N/A", "N/A").
pub fn format_sample_rate_and_bit_depth(track: &Track) -> String {
    match (track.sample_rate, track.bit_depth) {
        (Some(sr), Some(bd)) if bd > 0 => {
            format!("{} / {}-bit", format_sample_rate(Some(sr)), bd)
        }
        (Some(sr), _) => {
            format!("{} / N/A", format_sample_rate(Some(sr)))
        }
        (None, Some(bd)) if bd > 0 => {
            format!("N/A / {}-bit", bd)
        }
        _ => "N/A".to_string(),
    }
}

/// Returns whether a track qualifies as Hi-Res audio (>= 88.2 kHz or >= 24-bit).
pub fn is_hires_track(track: &Track) -> bool {
    track.sample_rate.map_or(false, |sr| sr >= 88200)
        || track.bit_depth.map_or(false, |bd| bd >= 24)
}

/// Formats bitrate into kbps string (e.g. "320 kbps", "1411 kbps").
pub fn format_bitrate(bitrate: Option<u32>) -> String {
    match bitrate {
        Some(br) => format!("{} kbps", br),
        None => "Lossless".to_string(),
    }
}

/// Formats audio channels count into human description (e.g. "Stereo (2.0)").
pub fn format_channels(channels: Option<u16>) -> String {
    match channels {
        Some(1) => "Mono (1.0)".to_string(),
        Some(2) => "Stereo (2.0)".to_string(),
        Some(6) => "Surround (5.1)".to_string(),
        Some(8) => "Surround (7.1)".to_string(),
        Some(n) => format!("{} Channels", n),
        None => "Stereo".to_string(),
    }
}

/// Formats audio quality badge label based on track metadata.
pub fn audio_quality_badge(track: &Track) -> &'static str {
    if let Some(sr) = track.sample_rate {
        if sr >= 88200 {
            return "HI-RES LOSSLESS";
        }
    }
    if let Some(br) = track.bitrate {
        if br >= 1000 {
            return "LOSSLESS";
        } else if br >= 320 {
            return "MAX 320K";
        } else if br >= 256 {
            return "HIGH 256K";
        }
    }
    // Check file extension if available
    let ext = track
        .path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "flac" | "alac" | "wav" | "aiff" => "LOSSLESS",
        "dsd" | "dsf" | "dff" => "MASTER DSD",
        "m4a" | "aac" => "AAC HI-FI",
        "mp3" => "MP3",
        _ => "HI-FI",
    }
}

/// Extracts file name from a path or returns fallback.
pub fn file_name_or_fallback(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| fallback.to_string())
}

/// Filters a list of tracks against a search query across title, artist, album, genre, and path.
pub fn filter_tracks<'a>(tracks: &'a [Track], query: &str) -> Vec<&'a Track> {
    let trimmed = query.trim().to_lowercase();
    if trimmed.is_empty() {
        return tracks.iter().collect();
    }

    tracks
        .iter()
        .filter(|t| {
            t.title.to_lowercase().contains(&trimmed)
                || t.artist.to_lowercase().contains(&trimmed)
                || t.album.to_lowercase().contains(&trimmed)
                || t.genre
                    .as_ref()
                    .map(|g| g.to_lowercase().contains(&trimmed))
                    .unwrap_or(false)
                || t.path.to_string_lossy().to_lowercase().contains(&trimmed)
        })
        .collect()
}

/// Represents an aggregated album with tracks and calculated totals.
#[derive(Debug, Clone, PartialEq)]
pub struct AlbumGroup {
    pub name: String,
    pub artist: String,
    pub year: Option<u32>,
    pub track_ids: Vec<TrackId>,
    pub total_duration: Duration,
    pub tracks: Vec<Track>,
}

/// Groups a slice of tracks into sorted [`AlbumGroup`] instances.
pub fn group_tracks_by_album(tracks: &[Track]) -> Vec<AlbumGroup> {
    let mut groups: HashMap<(String, String), AlbumGroup> = HashMap::new();

    for track in tracks {
        let key = (track.album.clone(), track.artist.clone());
        let group = groups.entry(key).or_insert_with(|| AlbumGroup {
            name: track.album.clone(),
            artist: track.artist.clone(),
            year: track.year,
            track_ids: Vec::new(),
            total_duration: Duration::ZERO,
            tracks: Vec::new(),
        });

        if group.year.is_none() && track.year.is_some() {
            group.year = track.year;
        }

        group.track_ids.push(track.id);
        group.total_duration += track.duration;
        group.tracks.push(track.clone());
    }

    let mut result: Vec<AlbumGroup> = groups.into_values().collect();
    // Sort albums by name alphabetically
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

/// Represents an aggregated artist with tracks, album count, and total duration.
#[derive(Debug, Clone, PartialEq)]
pub struct ArtistGroup {
    pub name: String,
    pub album_names: Vec<String>,
    pub track_ids: Vec<TrackId>,
    pub total_duration: Duration,
    pub tracks: Vec<Track>,
}

/// Groups a slice of tracks into sorted [`ArtistGroup`] instances.
pub fn group_tracks_by_artist(tracks: &[Track]) -> Vec<ArtistGroup> {
    let mut groups: HashMap<String, ArtistGroup> = HashMap::new();

    for track in tracks {
        let artist_name = track.artist.clone();
        let group = groups
            .entry(artist_name.clone())
            .or_insert_with(|| ArtistGroup {
                name: artist_name,
                album_names: Vec::new(),
                track_ids: Vec::new(),
                total_duration: Duration::ZERO,
                tracks: Vec::new(),
            });

        if !group.album_names.contains(&track.album) {
            group.album_names.push(track.album.clone());
        }

        group.track_ids.push(track.id);
        group.total_duration += track.duration;
        group.tracks.push(track.clone());
    }

    let mut result: Vec<ArtistGroup> = groups.into_values().collect();
    // Sort artists by name alphabetically
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

/// Cycles to the next [`LoopMode`] in sequence: Off -> Playlist -> Track -> Off.
pub fn cycle_loop_mode(current: LoopMode) -> LoopMode {
    match current {
        LoopMode::Off => LoopMode::Playlist,
        LoopMode::Playlist => LoopMode::Track,
        LoopMode::Track => LoopMode::Off,
    }
}

/// Returns the label describing the loop mode.
pub fn loop_mode_display(mode: LoopMode) -> (&'static str, &'static str) {
    match mode {
        LoopMode::Off => ("Off", "Repeat Off"),
        LoopMode::Playlist => ("All", "Repeat All"),
        LoopMode::Track => ("1", "Repeat Track"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::path::PathBuf;

    fn sample_track(title: &str, artist: &str, album: &str, secs: u64) -> Track {
        Track {
            id: TrackId::new(),
            title: title.to_string(),
            artist: artist.to_string(),
            album: album.to_string(),
            duration: Duration::from_secs(secs),
            path: PathBuf::from(format!("C:/Music/{}.flac", title)),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2024),
            genre: Some("Electronic".to_string()),
            sample_rate: Some(96000),
            bitrate: Some(1411),
            channels: Some(2),
            bit_depth: Some(24),
            date_added: Utc::now(),
        }
    }

    #[test]
    fn test_format_duration() {
        assert_eq!(format_duration(Duration::from_secs(0)), "00:00");
        assert_eq!(format_duration(Duration::from_secs(45)), "00:45");
        assert_eq!(format_duration(Duration::from_secs(125)), "02:05");
        assert_eq!(format_duration(Duration::from_secs(3665)), "1:01:05");
        assert_eq!(format_duration(Duration::from_secs(7325)), "2:02:05");
    }

    #[test]
    fn test_format_duration_human() {
        assert_eq!(format_duration_human(0), "0s");
        assert_eq!(format_duration_human(45), "45s");
        assert_eq!(format_duration_human(125), "2m 05s");
        assert_eq!(format_duration_human(3665), "1h 1m");
        assert_eq!(format_duration_human(90000), "1d 1h 0m");
    }

    #[test]
    fn test_format_sample_rate() {
        assert_eq!(format_sample_rate(Some(44100)), "44.1 kHz");
        assert_eq!(format_sample_rate(Some(48000)), "48 kHz");
        assert_eq!(format_sample_rate(Some(96000)), "96 kHz");
        assert_eq!(format_sample_rate(Some(192000)), "192 kHz");
        assert_eq!(format_sample_rate(None), "N/A");
    }

    #[test]
    fn test_sample_rate_and_bit_depth() {
        let mut track = sample_track("HiFi Song", "Artist", "Album", 180);
        track.sample_rate = Some(96000);
        track.bit_depth = Some(24);
        assert_eq!(format_sample_rate_and_bit_depth(&track), "96 kHz / 24-bit");
        assert!(is_hires_track(&track));

        // Missing bit_depth -> "44.1 kHz / N/A"
        track.sample_rate = Some(44100);
        track.bit_depth = None;
        track.bitrate = Some(320);
        assert_eq!(format_sample_rate_and_bit_depth(&track), "44.1 kHz / N/A");
        assert!(!is_hires_track(&track));

        // Missing all metadata -> "N/A"
        track.sample_rate = None;
        track.bit_depth = None;
        track.bitrate = None;
        assert_eq!(format_sample_rate_and_bit_depth(&track), "N/A");

        // Format bit depth helper
        assert_eq!(format_bit_depth(Some(24)), "24-bit");
        assert_eq!(format_bit_depth(None), "N/A");
    }

    #[test]
    fn test_format_bitrate() {
        assert_eq!(format_bitrate(Some(320)), "320 kbps");
        assert_eq!(format_bitrate(Some(1411)), "1411 kbps");
        assert_eq!(format_bitrate(None), "Lossless");
    }

    #[test]
    fn test_format_channels() {
        assert_eq!(format_channels(Some(1)), "Mono (1.0)");
        assert_eq!(format_channels(Some(2)), "Stereo (2.0)");
        assert_eq!(format_channels(Some(6)), "Surround (5.1)");
        assert_eq!(format_channels(None), "Stereo");
    }

    #[test]
    fn test_audio_quality_badge() {
        let hires_track = sample_track("Song 1", "Artist 1", "Album 1", 200);
        assert_eq!(audio_quality_badge(&hires_track), "HI-RES LOSSLESS");

        let mut mp3_track = sample_track("Song 2", "Artist 2", "Album 2", 180);
        mp3_track.sample_rate = Some(44100);
        mp3_track.bitrate = Some(320);
        mp3_track.path = PathBuf::from("C:/Music/song.mp3");
        assert_eq!(audio_quality_badge(&mp3_track), "MAX 320K");
    }

    #[test]
    fn test_filter_tracks() {
        let t1 = sample_track("Midnight City", "M83", "Hurry Up", 240);
        let t2 = sample_track("Get Lucky", "Daft Punk", "Random Access Memories", 248);
        let t3 = sample_track("Starboy", "The Weeknd", "Starboy", 230);
        let tracks = vec![t1, t2, t3];

        // Empty query
        assert_eq!(filter_tracks(&tracks, "").len(), 3);
        assert_eq!(filter_tracks(&tracks, "   ").len(), 3);

        // Match title
        let r1 = filter_tracks(&tracks, "midnight");
        assert_eq!(r1.len(), 1);
        assert_eq!(r1[0].title, "Midnight City");

        // Match artist
        let r2 = filter_tracks(&tracks, "daft");
        assert_eq!(r2.len(), 1);
        assert_eq!(r2[0].artist, "Daft Punk");

        // Match album
        let r3 = filter_tracks(&tracks, "memories");
        assert_eq!(r3.len(), 1);
        assert_eq!(r3[0].album, "Random Access Memories");

        // No match
        let r4 = filter_tracks(&tracks, "nonexistent");
        assert_eq!(r4.len(), 0);
    }

    #[test]
    fn test_group_tracks_by_album() {
        let t1 = sample_track("Song A", "Artist 1", "Album Alpha", 100);
        let t2 = sample_track("Song B", "Artist 1", "Album Alpha", 150);
        let t3 = sample_track("Song C", "Artist 2", "Album Beta", 200);
        let tracks = vec![t1, t2, t3];

        let albums = group_tracks_by_album(&tracks);
        assert_eq!(albums.len(), 2);
        assert_eq!(albums[0].name, "Album Alpha");
        assert_eq!(albums[0].tracks.len(), 2);
        assert_eq!(albums[0].total_duration, Duration::from_secs(250));
        assert_eq!(albums[1].name, "Album Beta");
        assert_eq!(albums[1].tracks.len(), 1);
    }

    #[test]
    fn test_group_tracks_by_artist() {
        let t1 = sample_track("Song A", "Daft Punk", "Discovery", 100);
        let t2 = sample_track("Song B", "Daft Punk", "RAM", 150);
        let t3 = sample_track("Song C", "Justice", "Cross", 200);
        let tracks = vec![t1, t2, t3];

        let artists = group_tracks_by_artist(&tracks);
        assert_eq!(artists.len(), 2);
        assert_eq!(artists[0].name, "Daft Punk");
        assert_eq!(artists[0].album_names.len(), 2);
        assert_eq!(artists[0].tracks.len(), 2);
        assert_eq!(artists[1].name, "Justice");
        assert_eq!(artists[1].tracks.len(), 1);
    }

    #[test]
    fn test_cycle_loop_mode() {
        assert_eq!(cycle_loop_mode(LoopMode::Off), LoopMode::Playlist);
        assert_eq!(cycle_loop_mode(LoopMode::Playlist), LoopMode::Track);
        assert_eq!(cycle_loop_mode(LoopMode::Track), LoopMode::Off);
    }
}
