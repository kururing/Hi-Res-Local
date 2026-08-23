//! Content Header region with prominent search bar and import action.

use crate::app::{App, Message, ViewMode};
use crate::theme::colors;
use crate::ui::components::{
    header_style, primary_button_style, scanning_banner, search_input_style,
    secondary_button_style, with_tooltip,
};
use crate::ui::helpers::format_duration_human;
use iced::widget::{
    button, column, container, horizontal_space, row, text, text_input, vertical_space,
};
use iced::{Alignment, Element, Length};

/// Renders the top content header bar.
pub fn render_header(app: &App) -> Element<'_, Message> {
    // 1. Search Bar with Clear Button
    let search_box = container(
        row![
            text("🔍").size(14).color(colors::TEXT_MUTED),
            text_input(
                "Search songs, artists, albums, genres...",
                &app.search_query
            )
            .on_input(Message::SearchQueryChanged)
            .size(13)
            .padding([8, 10])
            .style(search_input_style)
            .width(Length::Fill),
        ]
        .spacing(8)
        .align_y(Alignment::Center),
    )
    .width(Length::FillPortion(3));

    let mut search_row = row![search_box].spacing(8).align_y(Alignment::Center);

    if !app.search_query.is_empty() {
        let clear_btn = with_tooltip(
            button(text("✕").size(12))
                .padding([6, 10])
                .style(secondary_button_style)
                .on_press(Message::SearchQueryChanged(String::new())),
            "Clear search filter",
        );
        search_row = search_row.push(clear_btn);
    }

    // 2. Import Music Button
    let import_btn = with_tooltip(
        button(
            row![text("📁").size(14), text("Import Audio").size(13),]
                .spacing(6)
                .align_y(Alignment::Center),
        )
        .padding([8, 14])
        .style(primary_button_style)
        .on_press(Message::OpenFolderDialog),
        "Scan local folder for music files",
    );

    // 3. View Title & Subtitle Badge
    let (view_title, view_subtitle) = match app.active_view {
        ViewMode::Tracks => {
            let total_dur: u64 = app.tracks.iter().map(|t| t.duration.as_secs()).sum();
            (
                "Track Library".to_string(),
                format!(
                    "{} tracks • {}",
                    app.tracks.len(),
                    format_duration_human(total_dur)
                ),
            )
        }
        ViewMode::Albums => (
            "Albums".to_string(),
            "Grouped by album title & release metadata".to_string(),
        ),
        ViewMode::Artists => (
            "Artists".to_string(),
            "Indexed artists and discography".to_string(),
        ),
        ViewMode::Playlists => (
            "Playlists".to_string(),
            format!("{} custom playlists", app.playlists.len()),
        ),
        ViewMode::NowPlaying => (
            "Now Playing".to_string(),
            "Hi-Fi Master Audio Playback Engine".to_string(),
        ),
        ViewMode::Settings => (
            "Settings & System".to_string(),
            "Engine diagnostics and library statistics".to_string(),
        ),
    };

    let title_section = row![
        column![
            text(view_title).size(18).color(colors::TEXT_PRIMARY),
            text(view_subtitle).size(12).color(colors::TEXT_MUTED),
        ]
        .spacing(2),
        horizontal_space(),
        search_row,
        horizontal_space().width(12),
        import_btn,
    ]
    .spacing(12)
    .align_y(Alignment::Center);

    let mut header_column = column![title_section].spacing(10);

    // If active scan progress exists, show the progress banner
    if let Some(ref progress) = app.scan_progress {
        header_column = header_column.push(vertical_space().height(4));
        header_column = header_column.push(scanning_banner(progress));
    }

    container(header_column)
        .padding([14, 24])
        .width(Length::Fill)
        .style(header_style)
        .into()
}
