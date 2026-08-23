//! All Tracks view rendering rich track rows, metadata badges, and playback actions.

use crate::app::{App, Message};
use crate::theme::{colors, layout};
use crate::ui::components::{
    artwork_placeholder, badge, circular_play_button_style, empty_state, primary_button_style,
    secondary_button_style, track_row_button_style, with_tooltip,
};
use crate::ui::helpers::{audio_quality_badge, filter_tracks, format_duration};
use iced::widget::{button, column, container, row, scrollable, text, vertical_space};
use iced::{Alignment, Element, Length};

/// Renders the main Tracks view.
pub fn render_tracks_view(app: &App) -> Element<'_, Message> {
    let filtered_tracks = filter_tracks(&app.tracks, &app.search_query);

    // Empty State Handling
    if filtered_tracks.is_empty() {
        if !app.search_query.is_empty() {
            let msg = format!(
                "No tracks in your library match the search filter \"{}\".",
                app.search_query
            );
            return empty_state(
                "[?]",
                "No Matching Tracks Found",
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
                "Your Music Library is Empty",
                "Scan a local folder on your computer to index your Hi-Fi music files into Nghe Nhac Pro Max.",
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

    // 1. Table Column Headers
    let header_row = container(
        row![
            text("#")
                .size(12)
                .width(Length::Fixed(40.0))
                .color(colors::TEXT_MUTED),
            text("TITLE & ARTIST")
                .size(12)
                .width(Length::FillPortion(4))
                .color(colors::TEXT_MUTED),
            text("ALBUM")
                .size(12)
                .width(Length::FillPortion(3))
                .color(colors::TEXT_MUTED),
            text("QUALITY")
                .size(12)
                .width(Length::Fixed(120.0))
                .color(colors::TEXT_MUTED),
            text("TIME")
                .size(12)
                .width(Length::Fixed(60.0))
                .color(colors::TEXT_MUTED),
            text("ACTIONS")
                .size(12)
                .width(Length::Fixed(90.0))
                .color(colors::TEXT_MUTED),
        ]
        .spacing(12)
        .align_y(Alignment::Center),
    )
    .padding([8, 16])
    .style(|_theme| container::Style {
        background: Some(iced::Background::Color(colors::SURFACE_DEEP)),
        text_color: Some(colors::TEXT_MUTED),
        border: iced::Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: iced::border::Radius::from(layout::RADIUS_MD),
        },
        shadow: iced::Shadow::default(),
    });

    // 2. Track Rows
    let current_playing_id = app.playback_status.current_track.as_ref().map(|t| t.id);

    let mut rows_column = column![].spacing(4);

    for (index, track) in filtered_tracks.into_iter().enumerate() {
        let is_playing = current_playing_id == Some(track.id);
        let is_selected = app.selected_track_id == Some(track.id);
        let quality_tag = audio_quality_badge(track);
        let is_hires = quality_tag.contains("LOSSLESS") || quality_tag.contains("HI-RES");

        let number_or_icon = if is_playing {
            text("▶").size(12).color(colors::ACCENT_PRIMARY)
        } else {
            text(format!("{:02}", index + 1))
                .size(12)
                .color(colors::TEXT_MUTED)
        };

        let title_artist = row![
            artwork_placeholder(&track.title, 36.0),
            column![
                text(&track.title).size(13).color(if is_playing {
                    colors::ACCENT_PRIMARY
                } else {
                    colors::TEXT_PRIMARY
                }),
                text(&track.artist).size(11).color(colors::TEXT_SECONDARY),
            ]
            .spacing(2),
        ]
        .spacing(10)
        .align_y(Alignment::Center)
        .width(Length::FillPortion(4));

        let album_cell = text(&track.album)
            .size(12)
            .width(Length::FillPortion(3))
            .color(colors::TEXT_SECONDARY);

        let quality_cell = container(badge(quality_tag, is_hires))
            .width(Length::Fixed(120.0))
            .align_y(Alignment::Center);

        let duration_cell = text(format_duration(track.duration))
            .size(12)
            .width(Length::Fixed(60.0))
            .color(colors::TEXT_MUTED);

        let play_btn = with_tooltip(
            button(text(if is_playing { "||" } else { "▶" }).size(12))
                .padding([6, 12])
                .style(circular_play_button_style)
                .on_press(Message::PlayTrack(track.clone())),
            if is_playing { "Pause" } else { "Play track" },
        );

        let track_id = track.id;
        let select_btn = with_tooltip(
            button(text("i").size(12))
                .padding([6, 8])
                .style(secondary_button_style)
                .on_press(Message::SelectTrack(Some(track_id))),
            "Select track details",
        );

        let actions_cell = row![play_btn, select_btn]
            .spacing(6)
            .align_y(Alignment::Center)
            .width(Length::Fixed(90.0));

        let row_content = row![
            container(number_or_icon).width(Length::Fixed(40.0)),
            title_artist,
            album_cell,
            quality_cell,
            duration_cell,
            actions_cell,
        ]
        .spacing(12)
        .align_y(Alignment::Center);

        let row_button = button(row_content)
            .width(Length::Fill)
            .padding([8, 16])
            .style(track_row_button_style(is_selected, is_playing))
            .on_press(Message::PlayTrack(track.clone()));

        rows_column = rows_column.push(row_button);
    }

    let view_content = column![header_row, vertical_space().height(6), rows_column,]
        .spacing(4)
        .padding(16);

    scrollable(view_content)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
