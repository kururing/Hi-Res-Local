//! Fixed Bottom Player Bar component with media playback controls and metadata.

use crate::app::{App, Message, PlaybackState, ViewMode};
use crate::theme::{colors, layout};
use crate::ui::components::{
    artwork_placeholder, badge, circular_play_button_style, icon_control_button_style,
    player_bar_style, seek_slider_style, volume_slider_style, with_tooltip,
};
use crate::ui::helpers::{
    audio_quality_badge, cycle_loop_mode, format_duration, loop_mode_display,
};
use iced::widget::{button, column, container, horizontal_space, row, slider, text};
use iced::{Alignment, Element, Length};
use std::time::Duration;

/// Renders the fixed bottom player bar.
pub fn render_player(app: &App) -> Element<'_, Message> {
    let status = &app.playback_status;

    // ========================================================================
    // 1. Left Region: Current Track Artwork & Metadata
    // ========================================================================
    let track_info_section: Element<'_, Message> = match &status.current_track {
        Some(track) => {
            let quality_label = audio_quality_badge(track);
            let is_hires = quality_label.contains("LOSSLESS") || quality_label.contains("HI-RES");

            row![
                artwork_placeholder(&track.title, 44.0),
                column![
                    row![
                        text(&track.title).size(13).color(colors::TEXT_PRIMARY),
                        badge(quality_label, is_hires),
                    ]
                    .spacing(6)
                    .align_y(Alignment::Center),
                    text(format!("{} • {}", track.artist, track.album))
                        .size(11)
                        .color(colors::TEXT_SECONDARY),
                ]
                .spacing(2)
                .width(Length::Fill),
            ]
            .spacing(10)
            .align_y(Alignment::Center)
            .into()
        }
        None => row![
            artwork_placeholder("*", 44.0),
            column![
                text("No track playing")
                    .size(13)
                    .color(colors::TEXT_PRIMARY),
                text("Select a song to start listening")
                    .size(11)
                    .color(colors::TEXT_MUTED),
            ]
            .spacing(2),
        ]
        .spacing(10)
        .align_y(Alignment::Center)
        .into(),
    };

    let left_container = container(track_info_section)
        .width(Length::Fixed(220.0))
        .align_y(Alignment::Center);

    // ========================================================================
    // 2. Center Region: Playback Controls & Seek Bar
    // ========================================================================

    // Shuffle Button
    let shuffle_btn = with_tooltip(
        button(text("SHUF").size(11))
            .padding([6, 8])
            .style(icon_control_button_style(status.shuffle))
            .on_press(Message::ToggleShuffle),
        if status.shuffle {
            "Shuffle: ON"
        } else {
            "Shuffle: OFF"
        },
    );

    // Previous Track Button
    let prev_btn = with_tooltip(
        button(text("|<").size(12))
            .padding([6, 8])
            .style(icon_control_button_style(false))
            .on_press(Message::PreviousTrack),
        "Previous Track",
    );

    // Main Play/Pause Button
    let play_icon = match status.state {
        PlaybackState::Playing => "||",
        PlaybackState::Loading => "...",
        _ => "▶",
    };
    let play_tooltip_label = match status.state {
        PlaybackState::Playing => "Pause",
        PlaybackState::Loading => "Buffering...",
        _ => "Play",
    };
    let play_btn = with_tooltip(
        button(text(play_icon).size(14))
            .width(Length::Fixed(40.0))
            .height(Length::Fixed(40.0))
            .style(circular_play_button_style)
            .on_press(Message::TogglePlayPause),
        play_tooltip_label,
    );

    // Next Track Button
    let next_btn = with_tooltip(
        button(text(">|").size(12))
            .padding([6, 8])
            .style(icon_control_button_style(false))
            .on_press(Message::NextTrack),
        "Next Track",
    );

    // Repeat Mode Button
    let (_loop_badge, loop_tooltip) = loop_mode_display(status.loop_mode);
    let loop_label = match status.loop_mode {
        crate::app::LoopMode::Off => "REP",
        crate::app::LoopMode::Playlist => "REP ALL",
        crate::app::LoopMode::Track => "REP 1",
    };
    let repeat_btn = with_tooltip(
        button(row![text(loop_label).size(10),].align_y(Alignment::Center))
            .padding([6, 8])
            .style(icon_control_button_style(
                status.loop_mode != crate::app::LoopMode::Off,
            ))
            .on_press(Message::SetLoopMode(cycle_loop_mode(status.loop_mode))),
        loop_tooltip,
    );

    let controls_row = row![shuffle_btn, prev_btn, play_btn, next_btn, repeat_btn,]
        .spacing(10)
        .align_y(Alignment::Center);

    // Seek Slider
    let duration_secs = status.duration.as_secs_f64().max(1.0);
    let current_secs = status.position.as_secs_f64().min(duration_secs);

    let seek_slider_widget = slider(0.0..=duration_secs, current_secs, |val| {
        Message::Seek(Duration::from_secs_f64(val))
    })
    .step(1.0)
    .style(seek_slider_style)
    .width(Length::Fill);

    let seek_row = row![
        text(format_duration(status.position))
            .size(11)
            .color(colors::TEXT_MUTED),
        seek_slider_widget,
        text(format_duration(status.duration))
            .size(11)
            .color(colors::TEXT_MUTED),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    let center_container = container(
        column![controls_row, seek_row,]
            .spacing(4)
            .align_x(Alignment::Center),
    )
    .width(Length::Fill)
    .center_x(Length::Fill);

    // ========================================================================
    // 3. Right Region: Volume & Now Playing View Toggle
    // ========================================================================
    let current_volume = if status.is_muted { 0.0 } else { status.volume };
    let volume_label = if status.is_muted || current_volume == 0.0 {
        "MUTE"
    } else {
        "VOL"
    };

    let mute_btn = with_tooltip(
        button(text(volume_label).size(10))
            .padding([6, 6])
            .style(icon_control_button_style(status.is_muted))
            .on_press(Message::ToggleMute),
        if status.is_muted {
            "Unmute audio"
        } else {
            "Mute audio"
        },
    );

    let volume_slider_widget = slider(0.0..=1.0, current_volume, Message::SetVolume)
        .step(0.01_f32)
        .style(volume_slider_style)
        .width(Length::Fixed(70.0));

    let volume_percent = (current_volume * 100.0).round() as u32;

    let now_playing_btn = with_tooltip(
        button(
            row![
                text("✦").size(11).color(colors::ACCENT_PRIMARY),
                text("Full").size(11),
            ]
            .spacing(4)
            .align_y(Alignment::Center),
        )
        .padding([6, 8])
        .style(icon_control_button_style(
            app.active_view == ViewMode::NowPlaying,
        ))
        .on_press(Message::SelectView(ViewMode::NowPlaying)),
        "Expand Now Playing View",
    );

    let right_row = row![
        mute_btn,
        volume_slider_widget,
        text(format!("{}%", volume_percent))
            .size(10)
            .color(colors::TEXT_MUTED),
        horizontal_space().width(4),
        now_playing_btn,
    ]
    .spacing(6)
    .align_y(Alignment::Center);

    let right_container = container(right_row)
        .width(Length::Fixed(200.0))
        .align_x(Alignment::End)
        .align_y(Alignment::Center);

    // ========================================================================
    // Root Player Bar Container
    // ========================================================================
    container(
        row![left_container, center_container, right_container,]
            .spacing(12)
            .align_y(Alignment::Center)
            .width(Length::Fill),
    )
    .height(Length::Fixed(layout::PLAYER_BAR_HEIGHT))
    .padding([8, 16])
    .width(Length::Fill)
    .style(player_bar_style)
    .into()
}
