//! Playlists view supporting playlist creation, track management, and playback.

use crate::app::{App, Message};
use crate::theme::{colors, layout};
use crate::ui::components::{
    artwork_placeholder, badge, card_style, danger_button_style, empty_state, primary_button_style,
    secondary_button_style, with_tooltip,
};
use crate::ui::helpers::{format_duration, format_duration_human};
use iced::widget::{
    button, column, container, horizontal_space, row, scrollable, text, vertical_space,
};
use iced::{Alignment, Element, Length};

/// Renders the Playlists management view.
pub fn render_playlists_view(app: &App) -> Element<'_, Message> {
    // Top bar with New Playlist creation action
    let create_btn = with_tooltip(
        button(
            row![text("➕").size(13), text("New Playlist").size(13),]
                .spacing(6)
                .align_y(Alignment::Center),
        )
        .padding([8, 14])
        .style(primary_button_style)
        .on_press(Message::CreatePlaylist(format!(
            "Playlist #{}",
            app.playlists.len() + 1
        ))),
        "Create a new custom playlist",
    );

    let top_bar = row![
        text("Your Playlists").size(16).color(colors::TEXT_PRIMARY),
        horizontal_space(),
        create_btn,
    ]
    .align_y(Alignment::Center);

    if app.playlists.is_empty() {
        return container(
            column![
                top_bar,
                vertical_space().height(16),
                empty_state(
                    "📑",
                    "No Playlists Yet",
                    "Organize your Hi-Fi music into custom playlists for any vibe or genre.",
                    Some(
                        button(text("Create First Playlist").size(13))
                            .padding([10, 20])
                            .style(primary_button_style)
                            .on_press(Message::CreatePlaylist("My Hi-Fi Favorites".to_string()))
                            .into()
                    ),
                ),
            ]
            .spacing(8)
            .padding(20),
        )
        .width(Length::Fill)
        .height(Length::Fill)
        .into();
    }

    // Selected playlist details or playlists cards list
    let selected_pl = app
        .selected_playlist_id
        .and_then(|id| app.playlists.iter().find(|p| p.id == id));

    let main_content: Element<'_, Message> = match selected_pl {
        Some(playlist) => render_playlist_detail(app, playlist),
        None => render_playlists_list(app),
    };

    let view_content = column![top_bar, vertical_space().height(12), main_content,]
        .spacing(8)
        .padding(20);

    scrollable(view_content)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}

/// Renders the overview grid/list of all user playlists.
fn render_playlists_list<'a>(app: &'a App) -> Element<'a, Message> {
    let mut cards_column = column![].spacing(12);

    for playlist in &app.playlists {
        let pl_id = playlist.id;
        let track_count = playlist.track_ids.len();

        let play_first_btn: Element<'_, Message> =
            if let Some(&first_track_id) = playlist.track_ids.first() {
                with_tooltip(
                    button(
                        row![text("▶").size(12), text("Play").size(12),]
                            .spacing(6)
                            .align_y(Alignment::Center),
                    )
                    .padding([6, 12])
                    .style(primary_button_style)
                    .on_press(Message::PlayTrackById(first_track_id)),
                    "Play playlist from start",
                )
            } else {
                button(text("Empty").size(12))
                    .padding([6, 12])
                    .style(secondary_button_style)
                    .into()
            };

        let select_btn = with_tooltip(
            button(text("Open Playlist").size(12))
                .padding([6, 12])
                .style(secondary_button_style)
                .on_press(Message::SelectPlaylist(Some(pl_id))),
            "View and manage tracks in this playlist",
        );

        let delete_btn = with_tooltip(
            button(text("🗑").size(12))
                .padding([6, 10])
                .style(danger_button_style)
                .on_press(Message::DeletePlaylist(pl_id)),
            "Delete this playlist",
        );

        let card_content = row![
            artwork_placeholder(&playlist.name, 56.0),
            column![
                row![
                    text(&playlist.name).size(15).color(colors::TEXT_PRIMARY),
                    badge(format!("{} tracks", track_count), track_count > 0),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
                text(playlist.description.as_deref().unwrap_or("Custom playlist"),)
                    .size(12)
                    .color(colors::TEXT_SECONDARY),
                text(format!(
                    "Created: {}",
                    playlist.created_at.format("%b %d, %Y")
                ))
                .size(11)
                .color(colors::TEXT_MUTED),
            ]
            .spacing(4)
            .width(Length::Fill),
            row![play_first_btn, select_btn, delete_btn]
                .spacing(8)
                .align_y(Alignment::Center),
        ]
        .spacing(16)
        .align_y(Alignment::Center);

        let card = container(card_content)
            .padding(14)
            .width(Length::Fill)
            .style(card_style);

        cards_column = cards_column.push(card);
    }

    cards_column.into()
}

/// Renders the tracks and management details of a selected playlist.
fn render_playlist_detail<'a>(
    app: &'a App,
    playlist: &'a crate::app::Playlist,
) -> Element<'a, Message> {
    let pl_id = playlist.id;

    // Back to all playlists button
    let back_btn = button(
        row![text("←").size(13), text("All Playlists").size(12),]
            .spacing(4)
            .align_y(Alignment::Center),
    )
    .padding([6, 12])
    .style(secondary_button_style)
    .on_press(Message::SelectPlaylist(None));

    // Resolve tracks in playlist
    let playlist_tracks: Vec<_> = playlist
        .track_ids
        .iter()
        .filter_map(|id| app.tracks.iter().find(|t| &t.id == id))
        .collect();

    let total_secs: u64 = playlist_tracks.iter().map(|t| t.duration.as_secs()).sum();

    let play_all_btn: Element<'_, Message> = if let Some(first) = playlist_tracks.first() {
        with_tooltip(
            button(
                row![text("▶").size(12), text("Play Playlist").size(12),]
                    .spacing(6)
                    .align_y(Alignment::Center),
            )
            .padding([8, 14])
            .style(primary_button_style)
            .on_press(Message::PlayTrack((*first).clone())),
            "Start playback from first track",
        )
    } else {
        button(text("Empty Playlist").size(12))
            .padding([8, 14])
            .style(secondary_button_style)
            .into()
    };

    let delete_btn = with_tooltip(
        button(text("Delete Playlist").size(12))
            .padding([8, 12])
            .style(danger_button_style)
            .on_press(Message::DeletePlaylist(pl_id)),
        "Permanently delete this playlist",
    );

    let header_card = container(
        row![
            artwork_placeholder(&playlist.name, 72.0),
            column![
                text(&playlist.name).size(20).color(colors::TEXT_PRIMARY),
                text(format!(
                    "{} tracks • {}",
                    playlist_tracks.len(),
                    format_duration_human(total_secs)
                ))
                .size(12)
                .color(colors::TEXT_SECONDARY),
            ]
            .spacing(4)
            .width(Length::Fill),
            row![play_all_btn, delete_btn]
                .spacing(8)
                .align_y(Alignment::Center),
        ]
        .spacing(16)
        .align_y(Alignment::Center),
    )
    .padding(16)
    .width(Length::Fill)
    .style(card_style);

    let mut tracks_column = column![].spacing(4);

    if playlist_tracks.is_empty() {
        tracks_column = tracks_column.push(empty_state(
            "🎵",
            "This Playlist is Empty",
            "Add tracks to this playlist from the All Tracks view or scan your library.",
            None,
        ));
    } else {
        for (idx, track) in playlist_tracks.iter().enumerate() {
            let track_id = track.id;
            let play_btn = with_tooltip(
                button(text("▶").size(12))
                    .padding([6, 10])
                    .style(primary_button_style)
                    .on_press(Message::PlayTrackById(track_id)),
                "Play track",
            );

            let remove_btn = with_tooltip(
                button(text("✕").size(12))
                    .padding([6, 8])
                    .style(danger_button_style)
                    .on_press(Message::RemoveTrackFromPlaylist {
                        playlist_id: pl_id,
                        track_id,
                    }),
                "Remove track from this playlist",
            );

            let track_row_content = row![
                text(format!("{:02}", idx + 1))
                    .size(12)
                    .width(Length::Fixed(30.0))
                    .color(colors::TEXT_MUTED),
                column![
                    text(&track.title).size(13).color(colors::TEXT_PRIMARY),
                    text(&track.artist).size(11).color(colors::TEXT_SECONDARY),
                ]
                .spacing(2)
                .width(Length::FillPortion(4)),
                text(&track.album)
                    .size(12)
                    .width(Length::FillPortion(3))
                    .color(colors::TEXT_SECONDARY),
                text(format_duration(track.duration))
                    .size(12)
                    .width(Length::Fixed(60.0))
                    .color(colors::TEXT_MUTED),
                row![play_btn, remove_btn]
                    .spacing(6)
                    .align_y(Alignment::Center)
                    .width(Length::Fixed(70.0)),
            ]
            .spacing(12)
            .align_y(Alignment::Center);

            let track_card = container(track_row_content)
                .padding([8, 12])
                .width(Length::Fill)
                .style(|_theme| container::Style {
                    background: Some(iced::Background::Color(colors::SURFACE_PANEL)),
                    text_color: Some(colors::TEXT_PRIMARY),
                    border: iced::Border {
                        color: colors::BORDER_SUBTLE,
                        width: 1.0,
                        radius: iced::border::Radius::from(layout::RADIUS_SM),
                    },
                    shadow: iced::Shadow::default(),
                });

            tracks_column = tracks_column.push(track_card);
        }
    }

    column![
        back_btn,
        vertical_space().height(8),
        header_card,
        vertical_space().height(12),
        tracks_column,
    ]
    .spacing(6)
    .into()
}
