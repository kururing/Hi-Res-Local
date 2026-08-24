//! Now Playing view with large TIDAL-inspired hero layout and technical specs.

use crate::app::{App, Message, PlaybackState};
use crate::theme::{colors, layout};
use crate::ui::components::{
    artwork_placeholder, badge, card_style, circular_play_button_style, empty_state,
    hero_card_style, icon_control_button_style, primary_button_style, secondary_button_style,
    seek_slider_style, with_tooltip,
};
use crate::ui::helpers::{
    cycle_loop_mode, format_bit_depth, format_channels, format_duration, format_sample_rate,
    format_sample_rate_and_bit_depth, is_hires_track,
};
use iced::widget::{button, column, container, row, scrollable, slider, text, vertical_space};
use iced::{Alignment, Element, Length};
use std::time::Duration;

/// Renders the expanded/fullscreen Now Playing view.
pub fn render_now_playing_view(app: &App) -> Element<'_, Message> {
    let status = &app.playback_status;

    let track = match &status.current_track {
        Some(t) => t,
        None => {
            return empty_state(
                "[-]",
                "No Track Currently Playing",
                "Select any audio track from your library or playlists to view Hi-Fi playback details.",
                Some(
                    button(text("Browse Track Library").size(13))
                        .padding([10, 20])
                        .style(primary_button_style)
                        .on_press(Message::SelectView(crate::app::ViewMode::Tracks))
                        .into(),
                ),
            );
        }
    };

    let format_badge = format_sample_rate_and_bit_depth(track);
    let is_hires = is_hires_track(track);

    // ========================================================================
    // 1. Hero Artwork and Main Metadata
    // ========================================================================
    let hero_section = row![
        artwork_placeholder(&track.title, 180.0),
        column![
            row![
                badge(format_badge, is_hires),
                badge(
                    if is_hires {
                        "HI-RES AUDIO"
                    } else {
                        "STUDIO MASTER"
                    },
                    true
                ),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
            text(&track.title).size(26).color(colors::TEXT_PRIMARY),
            text(&track.artist).size(18).color(colors::ACCENT_PRIMARY),
            text(format!("Album: {}", track.album))
                .size(14)
                .color(colors::TEXT_SECONDARY),
            if let Some(year) = track.year {
                text(format!("Release Year: {}", year))
                    .size(12)
                    .color(colors::TEXT_MUTED)
            } else {
                text("Local Lossless Audio")
                    .size(12)
                    .color(colors::TEXT_MUTED)
            },
        ]
        .spacing(8)
        .width(Length::Fill),
    ]
    .spacing(24)
    .align_y(Alignment::Center);

    let hero_card = container(hero_section)
        .padding(24)
        .width(Length::Fill)
        .style(hero_card_style);

    // ========================================================================
    // 2. Playback Control Card
    // ========================================================================
    let duration_secs = status.duration.as_secs_f64().max(1.0);
    let current_secs = status.position.as_secs_f64().min(duration_secs);

    let seek_slider_widget = slider(0.0..=duration_secs, current_secs, |val| {
        Message::Seek(Duration::from_secs_f64(val))
    })
    .step(1.0)
    .style(seek_slider_style)
    .width(Length::Fill);

    let seek_bar = row![
        text(format_duration(status.position))
            .size(13)
            .color(colors::TEXT_SECONDARY),
        seek_slider_widget,
        text(format_duration(status.duration))
            .size(13)
            .color(colors::TEXT_SECONDARY),
    ]
    .spacing(12)
    .align_y(Alignment::Center);

    // Buttons
    let shuffle_btn = with_tooltip(
        button(text("SHUF").size(12))
            .padding([8, 14])
            .style(icon_control_button_style(status.shuffle))
            .on_press(Message::ToggleShuffle),
        "Toggle Shuffle Mode",
    );

    let prev_btn = with_tooltip(
        button(text("|<").size(14))
            .padding([8, 14])
            .style(icon_control_button_style(false))
            .on_press(Message::PreviousTrack),
        "Previous Track",
    );

    let play_icon = match status.state {
        PlaybackState::Playing => "||",
        PlaybackState::Loading => "...",
        _ => "▶",
    };
    let play_btn = with_tooltip(
        button(text(play_icon).size(18))
            .width(Length::Fixed(56.0))
            .height(Length::Fixed(56.0))
            .style(circular_play_button_style)
            .on_press(Message::TogglePlayPause),
        "Play / Pause",
    );

    let next_btn = with_tooltip(
        button(text(">|").size(14))
            .padding([8, 14])
            .style(icon_control_button_style(false))
            .on_press(Message::NextTrack),
        "Next Track",
    );

    let loop_label = match status.loop_mode {
        crate::app::LoopMode::Off => "REP",
        crate::app::LoopMode::Playlist => "REP ALL",
        crate::app::LoopMode::Track => "REP 1",
    };
    let repeat_btn = with_tooltip(
        button(text(loop_label).size(12))
            .padding([8, 14])
            .style(icon_control_button_style(
                status.loop_mode != crate::app::LoopMode::Off,
            ))
            .on_press(Message::SetLoopMode(cycle_loop_mode(status.loop_mode))),
        "Cycle Repeat Mode",
    );

    let controls_row = row![shuffle_btn, prev_btn, play_btn, next_btn, repeat_btn,]
        .spacing(16)
        .align_y(Alignment::Center);

    let controls_card = container(
        column![
            seek_bar,
            vertical_space().height(8),
            container(controls_row).center_x(Length::Fill),
        ]
        .spacing(8),
    )
    .padding(20)
    .width(Length::Fill)
    .style(card_style);

    // ========================================================================
    // 3. Hi-Fi Technical Audio Specs Panel
    // ========================================================================
    let spec_item = |label: &'static str, value: String| {
        row![
            text(label)
                .size(12)
                .width(Length::Fixed(180.0))
                .color(colors::TEXT_MUTED),
            text(value).size(13).color(colors::TEXT_PRIMARY),
        ]
        .spacing(8)
        .align_y(Alignment::Center)
    };

    let specs_content = column![
        text("TECHNICAL AUDIO SPECIFICATIONS")
            .size(12)
            .color(colors::TEXT_MUTED),
        spec_item(
            "Sample Rate & Bit Depth:",
            format_sample_rate_and_bit_depth(track)
        ),
        spec_item("Sample Rate:", format_sample_rate(track.sample_rate)),
        spec_item("Bit Depth:", format_bit_depth(track.bit_depth)),
        spec_item("Channels:", format_channels(track.channels)),
        spec_item("File Path:", track.path.to_string_lossy().to_string()),
        spec_item(
            "Date Added:",
            track.date_added.format("%Y-%m-%d %H:%M:%S UTC").to_string()
        ),
    ]
    .spacing(10);

    let specs_card = container(specs_content)
        .padding(20)
        .width(Length::Fill)
        .style(card_style);

    // ========================================================================
    // 4. Up Next / Queue Preview
    // ========================================================================
    let mut queue_column = column![text("UP NEXT IN LIBRARY")
        .size(12)
        .color(colors::TEXT_MUTED),]
    .spacing(8);

    let current_id = track.id;
    let upcoming_tracks: Vec<_> = app
        .tracks
        .iter()
        .filter(|t| t.id != current_id)
        .take(5)
        .collect();

    if upcoming_tracks.is_empty() {
        queue_column = queue_column.push(
            text("No additional tracks in queue.")
                .size(13)
                .color(colors::TEXT_MUTED),
        );
    } else {
        for next_track in upcoming_tracks {
            let next_id = next_track.id;
            let row_item = row![
                artwork_placeholder(&next_track.title, 36.0),
                column![
                    text(&next_track.title).size(13).color(colors::TEXT_PRIMARY),
                    text(&next_track.artist)
                        .size(11)
                        .color(colors::TEXT_SECONDARY),
                ]
                .spacing(2)
                .width(Length::Fill),
                text(format_duration(next_track.duration))
                    .size(11)
                    .color(colors::TEXT_MUTED),
                button(text("▶").size(11))
                    .padding([4, 8])
                    .style(secondary_button_style)
                    .on_press(Message::PlayTrackById(next_id)),
            ]
            .spacing(10)
            .align_y(Alignment::Center);

            queue_column = queue_column.push(
                container(row_item)
                    .padding([6, 10])
                    .width(Length::Fill)
                    .style(|_theme| container::Style {
                        background: Some(iced::Background::Color(colors::SURFACE_DEEP)),
                        text_color: Some(colors::TEXT_PRIMARY),
                        border: iced::Border {
                            color: colors::BORDER_SUBTLE,
                            width: 1.0,
                            radius: iced::border::Radius::from(layout::RADIUS_SM),
                        },
                        shadow: iced::Shadow::default(),
                    }),
            );
        }
    }

    let queue_card = container(queue_column)
        .padding(20)
        .width(Length::Fill)
        .style(card_style);

    let view_content = column![
        hero_card,
        vertical_space().height(8),
        controls_card,
        vertical_space().height(8),
        specs_card,
        vertical_space().height(8),
        queue_card,
    ]
    .spacing(8)
    .padding(20);

    scrollable(view_content)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
