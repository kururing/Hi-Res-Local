//! Artists view grouping library tracks by artist name and discography.

use crate::app::{App, Message};
use crate::theme::colors;
use crate::ui::components::{
    artwork_placeholder, badge, card_style, empty_state, primary_button_style,
    secondary_button_style, with_tooltip,
};
use crate::ui::helpers::{format_duration_human, group_tracks_by_artist};
use iced::widget::{button, column, container, row, scrollable, text, vertical_space};
use iced::{Alignment, Element, Length};

/// Renders the Artists view.
pub fn render_artists_view(app: &App) -> Element<'_, Message> {
    let all_artists = group_tracks_by_artist(&app.tracks);

    // Search filtering for artists
    let query = app.search_query.trim().to_lowercase();
    let filtered_artists: Vec<_> = if query.is_empty() {
        all_artists
    } else {
        all_artists
            .into_iter()
            .filter(|a| {
                a.name.to_lowercase().contains(&query)
                    || a.album_names
                        .iter()
                        .any(|alb| alb.to_lowercase().contains(&query))
            })
            .collect()
    };

    let artists_count = filtered_artists.len();

    if filtered_artists.is_empty() {
        if !app.search_query.is_empty() {
            let msg = format!("No artists in your library match \"{}\".", app.search_query);
            return empty_state(
                "[?]",
                "No Matching Artists",
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
                "No Artists Found",
                "Import your audio collection to see your favorite artists and bands indexed here.",
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

    let mut artists_column = column![].spacing(12);

    for artist in filtered_artists {
        let first_track = artist.tracks.first().cloned();
        let total_secs = artist.total_duration.as_secs();

        let play_btn: Element<'_, Message> = if let Some(track) = first_track {
            with_tooltip(
                button(
                    row![text("▶").size(12), text("Play Artist").size(12),]
                        .spacing(6)
                        .align_y(Alignment::Center),
                )
                .padding([6, 12])
                .style(primary_button_style)
                .on_press(Message::PlayTrack(track)),
                "Play all songs by this artist",
            )
        } else {
            button(text("No Tracks").size(12))
                .padding([6, 12])
                .style(secondary_button_style)
                .into()
        };

        let search_artist_btn = with_tooltip(
            button(text("View Tracks").size(12))
                .padding([6, 12])
                .style(secondary_button_style)
                .on_press(Message::SearchQueryChanged(artist.name.clone())),
            "Filter track list by this artist",
        );

        let mut albums_preview = row![].spacing(6).align_y(Alignment::Center);
        for alb in artist.album_names.iter().take(3) {
            albums_preview = albums_preview.push(badge(alb.clone(), false));
        }
        if artist.album_names.len() > 3 {
            let extra = artist.album_names.len() - 3;
            albums_preview = albums_preview.push(badge(format!("+{} more", extra), false));
        }

        let card_content = row![
            artwork_placeholder(&artist.name, 64.0),
            column![
                text(artist.name).size(16).color(colors::TEXT_PRIMARY),
                text(format!(
                    "{} songs • {} albums • {}",
                    artist.tracks.len(),
                    artist.album_names.len(),
                    format_duration_human(total_secs)
                ))
                .size(12)
                .color(colors::TEXT_SECONDARY),
                albums_preview,
            ]
            .spacing(4)
            .width(Length::Fill),
            row![play_btn, search_artist_btn]
                .spacing(8)
                .align_y(Alignment::Center),
        ]
        .spacing(16)
        .align_y(Alignment::Center);

        let card = container(card_content)
            .padding(14)
            .width(Length::Fill)
            .style(card_style);

        artists_column = artists_column.push(card);
    }

    let view_content = column![
        text(format!("All Artists ({})", artists_count))
            .size(14)
            .color(colors::TEXT_MUTED),
        vertical_space().height(8),
        artists_column,
    ]
    .spacing(8)
    .padding(20);

    scrollable(view_content)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
