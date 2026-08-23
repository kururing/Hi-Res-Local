//! UI components, views, and rendering module placeholder.
//!
//! This module provides the entry view renderer for [`crate::app::App`].
//! UI feature workers can implement layout panels, track tables, player bar,
//! and sidebar navigation here.

use crate::app::{App, Message};
use iced::widget::{column, container, text};
use iced::{Element, Length};

/// Renders the root application view.
pub fn render(app: &App) -> Element<'_, Message> {
    container(
        column![
            text("Nghe Nhac Pro Max").size(28),
            text(format!("Active View: {:?}", app.active_view)).size(16),
            text(format!("Tracks Loaded: {}", app.tracks.len())).size(14),
            text(format!("Playback State: {:?}", app.playback_status.state)).size(14),
        ]
        .spacing(12),
    )
    .padding(24)
    .width(Length::Fill)
    .height(Length::Fill)
    .center_x(Length::Fill)
    .center_y(Length::Fill)
    .into()
}
