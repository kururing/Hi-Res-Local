//! View modules for different tabs in the application.

pub mod albums;
pub mod artists;
pub mod now_playing;
pub mod playlists;
pub mod settings;
pub mod tracks;

use crate::app::{App, Message, ViewMode};
use iced::Element;

/// Routes and renders the active view mode according to [`App::active_view`].
pub fn render_active_view(app: &App) -> Element<'_, Message> {
    match app.active_view {
        ViewMode::Tracks => tracks::render_tracks_view(app),
        ViewMode::Albums => albums::render_albums_view(app),
        ViewMode::Artists => artists::render_artists_view(app),
        ViewMode::Playlists => playlists::render_playlists_view(app),
        ViewMode::NowPlaying => now_playing::render_now_playing_view(app),
        ViewMode::Settings => settings::render_settings_view(app),
    }
}
