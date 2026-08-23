//! Albums view grouping library tracks by album title and artist.

use crate::app::{App, Message};
use crate::theme::colors;
use crate::ui::components::{
    artwork_placeholder, badge, card_style, empty_state, primary_button_style,
    secondary_button_style, with_tooltip,
};
use crate::ui::helpers::{format_duration_human, group_tracks_by_album};
use iced::widget::{button, column, container, row, scrollable, text, vertical_space};
use iced::{Alignment, Element, Length};

/// Renders the Albums grid/card view.
pub fn render_albums_view(app: &App) -> Element<'_, Message> {
    let all_albums = group_tracks_by_album(&app.tracks);

    // Search filtering for albums
    let query = app.search_query.trim().to_lowercase();
    let filtered_albums: Vec<_> = if query.is_empty() {
        all_albums
    } else {
        all_albums
            .into_iter()
            .filter(|a| {
                a.name.to_lowercase().contains(&query)
                    || a.artist.to_lowercase().contains(&query)
                    || a.year
                        .map(|y| y.to_string().contains(&query))
                        .unwrap_or(false)
            })
            .collect()
    };

    let albums_count = filtered_albums.len();

    if filtered_albums.is_empty() {
        if !app.search_query.is_empty() {
            let msg = format!("No albums in your library match \"{}\".", app.search_query);
            return empty_state(
                "[?]",
                "No Matching Albums",
                msg,
                Some(
                    button(text("Clear Search Filter").size(13))
                        .padding([10, 18])
                        .style(secondary_button_style)
                        .on_press(Message::SearchQueryChanged(String::new()))
                        .into(),
                ),
            );
        } else {
            return empty_state(
                "[-]",
                "No Albums Found",
                "Scan your music directory to automatically organize your tracks into albums.",
                Some(
                    button(
                        row![
                            text("+").size(16).color(colors::OLED_BLACK),
                            text("Scan Music Folder").size(13),
                        ]
                        .spacing(8)
                        .align_y(Alignment::Center),
                    )
                    .padding([10, 20])
                    .style(primary_button_style)
                    .on_press(Message::OpenFolderDialog)
                    .into(),
                ),
            );
        }
    }

    let mut albums_column = column![].spacing(12);

    for album in filtered_albums {
        let first_track = album.tracks.first().cloned();
        let total_secs = album.total_duration.as_secs();

        let play_btn: Element<'_, Message> = if let Some(track) = first_track {
            with_tooltip(
                button(
                    row![text("▶").size(12), text("Play Album").size(12),]
                        .spacing(6)
                        .align_y(Alignment::Center),
                )
                .padding([6, 12])
                .style(primary_button_style)
                .on_press(Message::PlayTrack(track)),
                "Play this album from track 1",
            )
        } else {
            button(text("No Tracks").size(12))
                .padding([6, 12])
                .style(secondary_button_style)
                .into()
        };

        let search_album_btn = with_tooltip(
            button(text("View Tracks").size(12))
                .padding([6, 12])
                .style(secondary_button_style)
                .on_press(Message::SearchQueryChanged(album.name.clone())),
            "Filter track list by this album",
        );

        let mut meta_row = row![text(format!(
            "{} tracks • {}",
            album.tracks.len(),
            format_duration_human(total_secs)
        ))
        .size(12)
        .color(colors::TEXT_MUTED),]
        .spacing(8)
        .align_y(Alignment::Center);

        if let Some(year) = album.year {
            meta_row = meta_row.push(badge(year.to_string(), false));
        }

        let card_content = row![
            artwork_placeholder(&album.name, 64.0),
            column![
                text(album.name).size(15).color(colors::TEXT_PRIMARY),
                text(album.artist).size(13).color(colors::TEXT_SECONDARY),
                meta_row,
            ]
            .spacing(4)
            .width(Length::Fill),
            row![play_btn, search_album_btn]
                .spacing(8)
                .align_y(Alignment::Center),
        ]
        .spacing(16)
        .align_y(Alignment::Center);

        let card = container(card_content)
            .padding(14)
            .width(Length::Fill)
            .style(card_style);

        albums_column = albums_column.push(card);
    }

    let view_content = column![
        text(format!("All Albums ({})", albums_count))
            .size(14)
            .color(colors::TEXT_MUTED),
        vertical_space().height(8),
        albums_column,
    ]
    .spacing(8)
    .padding(20);

    scrollable(view_content)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
