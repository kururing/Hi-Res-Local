//! Accessible Sidebar navigation component for OLED-dark TIDAL interface.

use crate::app::{App, Message, ViewMode};
use crate::theme::{colors, layout};
use crate::ui::components::{badge, nav_button_style, primary_button_style, sidebar_style};
use crate::ui::helpers::format_duration_human;
use iced::widget::{
    button, column, container, horizontal_space, row, scrollable, text, vertical_space,
};
use iced::{Alignment, Element, Length};

/// Renders the left sidebar navigation region.
pub fn render_sidebar(app: &App) -> Element<'_, Message> {
    // 1. App Brand Header
    let brand_header = column![
        row![
            text("✦").size(22).color(colors::ACCENT_PRIMARY),
            text("PRO MAX").size(20).color(colors::TEXT_PRIMARY),
        ]
        .spacing(8)
        .align_y(Alignment::Center),
        text("MASTER QUALITY AUDIO")
            .size(10)
            .color(colors::TEXT_MUTED),
    ]
    .spacing(4);

    // 2. Navigation Item Helper
    let nav_item =
        |mode: ViewMode, icon: &'static str, label: &'static str, count: Option<usize>| {
            let is_active = app.active_view == mode;
            let mut row_content = row![
                text(icon).size(16),
                text(label).size(14).color(if is_active {
                    colors::TEXT_PRIMARY
                } else {
                    colors::TEXT_SECONDARY
                }),
                horizontal_space(),
            ]
            .spacing(12)
            .align_y(Alignment::Center);

            if let Some(c) = count {
                row_content = row_content.push(badge(c.to_string(), is_active));
            }

            button(row_content)
                .width(Length::Fill)
                .padding([10, 14])
                .style(nav_button_style(is_active))
                .on_press(Message::SelectView(mode))
        };

    // 3. Navigation Sections
    let library_nav = column![
        text("DISCOVER & LIBRARY")
            .size(11)
            .color(colors::TEXT_MUTED),
        nav_item(ViewMode::Tracks, "🎵", "All Tracks", Some(app.tracks.len())),
        nav_item(ViewMode::Albums, "💿", "Albums", None),
        nav_item(ViewMode::Artists, "🎙️", "Artists", None),
        nav_item(
            ViewMode::Playlists,
            "📑",
            "Playlists",
            Some(app.playlists.len())
        ),
    ]
    .spacing(6);

    let playing_nav = column![
        text("PLAYBACK").size(11).color(colors::TEXT_MUTED),
        nav_item(ViewMode::NowPlaying, "🎛️", "Now Playing", None),
        nav_item(ViewMode::Settings, "⚙️", "Settings & Stats", None),
    ]
    .spacing(6);

    // 4. Quick Library Summary Card
    let total_secs: u64 = app.tracks.iter().map(|t| t.duration.as_secs()).sum();
    let stats_card = container(
        column![
            row![
                text("Library Status")
                    .size(12)
                    .color(colors::TEXT_SECONDARY),
                horizontal_space(),
                badge("HI-FI", true),
            ]
            .align_y(Alignment::Center),
            text(format!("{} tracks", app.tracks.len()))
                .size(14)
                .color(colors::TEXT_PRIMARY),
            text(format!("Duration: {}", format_duration_human(total_secs)))
                .size(11)
                .color(colors::TEXT_MUTED),
        ]
        .spacing(6),
    )
    .padding(12)
    .style(|_theme| container::Style {
        background: Some(iced::Background::Color(colors::SURFACE_PANEL)),
        text_color: Some(colors::TEXT_PRIMARY),
        border: iced::Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: iced::border::Radius::from(layout::RADIUS_MD),
        },
        shadow: iced::Shadow::default(),
    });

    // 5. Import Action Button
    let import_btn = button(
        row![text("📁").size(15), text("Scan Music Folder").size(13),]
            .spacing(8)
            .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .padding([10, 16])
    .style(primary_button_style)
    .on_press(Message::OpenFolderDialog);

    // Assembly of sidebar
    let sidebar_content = column![
        brand_header,
        vertical_space().height(16),
        library_nav,
        vertical_space().height(16),
        playing_nav,
        vertical_space().height(24),
        stats_card,
        vertical_space().height(12),
        import_btn,
    ]
    .spacing(4)
    .padding(16);

    container(scrollable(sidebar_content))
        .width(Length::Fixed(layout::SIDEBAR_WIDTH))
        .height(Length::Fill)
        .style(sidebar_style)
        .into()
}
