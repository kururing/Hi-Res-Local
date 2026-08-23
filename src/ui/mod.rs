//! UI components, views, and layout rendering for Nghe Nhac Pro Max.
//!
//! Implements a polished TIDAL-inspired native Iced desktop interface with
//! an OLED-dark three-region layout: accessible sidebar navigation, content
//! header with search and folder import, responsive views for tracks, albums,
//! artists, playlists, now playing, and settings, plus a fixed bottom player bar.

pub mod components;
pub mod header;
pub mod helpers;
pub mod player;
pub mod sidebar;
pub mod views;

use crate::app::{App, Message};
use crate::theme::colors;
use iced::widget::{column, container, row};
use iced::{Element, Length};

/// Renders the root application view with OLED-Dark three-region layout.
pub fn render(app: &App) -> Element<'_, Message> {
    // Left: Accessible Sidebar Navigation
    let sidebar_region = sidebar::render_sidebar(app);

    // Center/Right: Top Header + Active Content View + Bottom Fixed Player
    let content_header = header::render_header(app);
    let active_view_content = container(views::render_active_view(app))
        .width(Length::Fill)
        .height(Length::Fill);
    let bottom_player = player::render_player(app);

    let main_column = column![content_header, active_view_content, bottom_player,]
        .width(Length::Fill)
        .height(Length::Fill);

    // Root three-region layout
    container(
        row![sidebar_region, main_column,]
            .width(Length::Fill)
            .height(Length::Fill),
    )
    .width(Length::Fill)
    .height(Length::Fill)
    .style(|_theme| container::Style {
        background: Some(iced::Background::Color(colors::OLED_BLACK)),
        text_color: Some(colors::TEXT_PRIMARY),
        border: iced::Border::default(),
        shadow: iced::Shadow::default(),
    })
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{
        LoopMode, PlaybackState, PlaybackStatus, Playlist, PlaylistId, ScanProgress, Track,
        TrackId, ViewMode,
    };
    use chrono::Utc;
    use std::path::PathBuf;
    use std::time::Duration;

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
            date_added: Utc::now(),
        }
    }

    #[test]
    fn test_render_default_app() {
        let app = App::default();
        let _element = render(&app);
    }

    #[test]
    fn test_render_all_view_modes_empty() {
        let mut app = App::default();
        let view_modes = [
            ViewMode::Tracks,
            ViewMode::Albums,
            ViewMode::Artists,
            ViewMode::Playlists,
            ViewMode::NowPlaying,
            ViewMode::Settings,
        ];

        for mode in view_modes {
            app.active_view = mode;
            let _element = render(&app);
        }
    }

    #[test]
    fn test_render_populated_app() {
        let t1 = sample_track("Get Lucky", "Daft Punk", "Random Access Memories", 248);
        let t2 = sample_track("Instant Crush", "Daft Punk", "Random Access Memories", 337);
        let t3 = sample_track("Starboy", "The Weeknd", "Starboy", 230);
        let t1_id = t1.id;
        let t2_id = t2.id;

        let pl = Playlist {
            id: PlaylistId::new(),
            name: "Hi-Fi Favorites".to_string(),
            description: Some("My lossless collection".to_string()),
            track_ids: vec![t1_id, t2_id],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let mut app = App {
            active_view: ViewMode::Tracks,
            search_query: String::new(),
            selected_track_id: Some(t1_id),
            selected_playlist_id: Some(pl.id),
            tracks: vec![t1.clone(), t2, t3],
            playlists: vec![pl],
            playback_status: PlaybackStatus {
                state: PlaybackState::Playing,
                current_track: Some(t1),
                position: Duration::from_secs(45),
                duration: Duration::from_secs(248),
                volume: 0.85,
                is_muted: false,
                loop_mode: LoopMode::Playlist,
                shuffle: true,
            },
            scan_progress: Some(ScanProgress {
                total_files: 100,
                scanned_files: 42,
                current_path: Some(PathBuf::from("C:/Music/test.flac")),
            }),
        };

        // Render all views with full population
        let view_modes = [
            ViewMode::Tracks,
            ViewMode::Albums,
            ViewMode::Artists,
            ViewMode::Playlists,
            ViewMode::NowPlaying,
            ViewMode::Settings,
        ];

        for mode in view_modes {
            app.active_view = mode;
            let _element = render(&app);
        }
    }

    #[test]
    fn test_render_search_state() {
        let t1 = sample_track("Get Lucky", "Daft Punk", "Random Access Memories", 248);
        let mut app = App {
            tracks: vec![t1],
            search_query: "Nonexistent song title".to_string(),
            ..Default::default()
        };

        for mode in [
            ViewMode::Tracks,
            ViewMode::Albums,
            ViewMode::Artists,
            ViewMode::Playlists,
        ] {
            app.active_view = mode;
            let _element = render(&app);
        }
    }
}
