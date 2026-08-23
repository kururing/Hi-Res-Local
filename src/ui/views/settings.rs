//! Settings and System Diagnostics view for library metrics, audio engine, and shortcuts.

use crate::app::{App, Message};
use crate::theme::{colors, layout};
use crate::ui::components::{badge, card_style, primary_button_style};
use crate::ui::helpers::{format_duration_human, group_tracks_by_album, group_tracks_by_artist};
use iced::widget::{
    button, column, container, horizontal_space, row, scrollable, text, vertical_space,
};
use iced::{Alignment, Element, Length};

/// Renders the Settings & Diagnostics view.
pub fn render_settings_view(app: &App) -> Element<'_, Message> {
    let total_tracks = app.tracks.len();
    let albums = group_tracks_by_album(&app.tracks);
    let artists = group_tracks_by_artist(&app.tracks);
    let total_secs: u64 = app.tracks.iter().map(|t| t.duration.as_secs()).sum();

    let stat_box = |label: &'static str, val: String, sub: &'static str| {
        container(
            column![
                text(label).size(11).color(colors::TEXT_MUTED),
                text(val).size(20).color(colors::TEXT_PRIMARY),
                text(sub).size(10).color(colors::TEXT_SECONDARY),
            ]
            .spacing(3),
        )
        .padding(14)
        .width(Length::FillPortion(1))
        .style(|_theme| container::Style {
            background: Some(iced::Background::Color(colors::SURFACE_DEEP)),
            text_color: Some(colors::TEXT_PRIMARY),
            border: iced::Border {
                color: colors::BORDER_SUBTLE,
                width: 1.0,
                radius: iced::border::Radius::from(layout::RADIUS_MD),
            },
            shadow: iced::Shadow::default(),
        })
    };

    // 1. Library Statistics Panel
    let stats_grid = row![
        stat_box("TOTAL TRACKS", total_tracks.to_string(), "Indexed songs"),
        stat_box("TOTAL ALBUMS", albums.len().to_string(), "Unique releases"),
        stat_box("TOTAL ARTISTS", artists.len().to_string(), "Creators"),
        stat_box(
            "TOTAL DURATION",
            format_duration_human(total_secs),
            "Audio playtime"
        ),
    ]
    .spacing(12);

    let library_card = container(
        column![
            row![
                text("MUSIC LIBRARY METRICS")
                    .size(12)
                    .color(colors::TEXT_MUTED),
                horizontal_space(),
                button(
                    row![text("📁").size(13), text("Rescan Music Folder").size(12),]
                        .spacing(6)
                        .align_y(Alignment::Center),
                )
                .padding([6, 12])
                .style(primary_button_style)
                .on_press(Message::OpenFolderDialog),
            ]
            .align_y(Alignment::Center),
            vertical_space().height(8),
            stats_grid,
        ]
        .spacing(8),
    )
    .padding(20)
    .width(Length::Fill)
    .style(card_style);

    // 2. Audio Engine Configuration
    let audio_spec_row = |name: &'static str, value: &'static str| {
        row![
            text(name)
                .size(12)
                .width(Length::Fixed(180.0))
                .color(colors::TEXT_MUTED),
            text(value).size(13).color(colors::TEXT_PRIMARY),
        ]
        .spacing(8)
        .align_y(Alignment::Center)
    };

    let audio_engine_card = container(
        column![
            row![
                text("NATIVE AUDIO ENGINE")
                    .size(12)
                    .color(colors::TEXT_MUTED),
                horizontal_space(),
                badge("LOW-LATENCY WASAPI", true),
            ]
            .align_y(Alignment::Center),
            vertical_space().height(6),
            audio_spec_row(
                "Playback Backend:",
                "Rodio 0.20 + Symphonia 0.5 (Native Cpal)"
            ),
            audio_spec_row(
                "Supported Codecs:",
                "FLAC, ALAC, WAV, AIFF, DSD, MP3, AAC, OGG Vorbis"
            ),
            audio_spec_row(
                "Maximum Sample Rate:",
                "Up to 192.0 kHz / 32-bit Float Precision"
            ),
            audio_spec_row("Output Routing:", "Default WASAPI / DirectSound Endpoint"),
            audio_spec_row(
                "Metadata Extraction:",
                "Lofty 0.21 Full ID3v2 / Vorbis Comments"
            ),
        ]
        .spacing(8),
    )
    .padding(20)
    .width(Length::Fill)
    .style(card_style);

    // 3. OLED Dark Theme Palette Tokens
    let color_chip = |name: &'static str, color: iced::Color, hex: &'static str| {
        row![
            container(text("").size(1))
                .width(Length::Fixed(18.0))
                .height(Length::Fixed(18.0))
                .style(move |_theme| container::Style {
                    background: Some(iced::Background::Color(color)),
                    text_color: None,
                    border: iced::Border {
                        color: colors::BORDER_SUBTLE,
                        width: 1.0,
                        radius: iced::border::Radius::from(4.0),
                    },
                    shadow: iced::Shadow::default(),
                }),
            column![
                text(name).size(12).color(colors::TEXT_PRIMARY),
                text(hex).size(10).color(colors::TEXT_MUTED),
            ]
            .spacing(1),
        ]
        .spacing(8)
        .align_y(Alignment::Center)
    };

    let theme_card = container(
        column![
            text("OLED-DARK THEME TOKENS")
                .size(12)
                .color(colors::TEXT_MUTED),
            vertical_space().height(6),
            row![
                color_chip("OLED Black", colors::OLED_BLACK, "#000000"),
                horizontal_space().width(16),
                color_chip("Surface Deep", colors::SURFACE_DEEP, "#0A0A0A"),
                horizontal_space().width(16),
                color_chip("Surface Panel", colors::SURFACE_PANEL, "#121212"),
                horizontal_space().width(16),
                color_chip("Accent Emerald", colors::ACCENT_PRIMARY, "#1FD673"),
            ]
            .align_y(Alignment::Center),
        ]
        .spacing(8),
    )
    .padding(20)
    .width(Length::Fill)
    .style(card_style);

    // 4. Keyboard Shortcuts Reference
    let shortcut_row = |keys: &'static str, desc: &'static str| {
        row![
            container(text(keys).size(11).color(colors::TEXT_PRIMARY),)
                .padding([3, 8])
                .style(|_theme| container::Style {
                    background: Some(iced::Background::Color(colors::SURFACE_ELEVATED)),
                    text_color: Some(colors::TEXT_PRIMARY),
                    border: iced::Border {
                        color: colors::BORDER_FOCUS,
                        width: 1.0,
                        radius: iced::border::Radius::from(layout::RADIUS_SM),
                    },
                    shadow: iced::Shadow::default(),
                }),
            text(desc).size(12).color(colors::TEXT_SECONDARY),
        ]
        .spacing(12)
        .align_y(Alignment::Center)
    };

    let shortcuts_card = container(
        column![
            text("KEYBOARD & NAVIGATION CONTROLS")
                .size(12)
                .color(colors::TEXT_MUTED),
            vertical_space().height(6),
            row![
                column![
                    shortcut_row("Space", "Play / Pause active playback"),
                    shortcut_row("Left / Right", "Seek backward / forward"),
                ]
                .spacing(8)
                .width(Length::FillPortion(1)),
                column![
                    shortcut_row("Up / Down", "Increase / Decrease volume"),
                    shortcut_row("Ctrl + F", "Search songs & artists"),
                ]
                .spacing(8)
                .width(Length::FillPortion(1)),
            ]
            .spacing(16),
        ]
        .spacing(8),
    )
    .padding(20)
    .width(Length::Fill)
    .style(card_style);

    // 5. About Footer
    let about_card = container(
        row![
            text("Nghe Nhac Pro Max v0.1.0 • Native Iced Desktop Client • TIDAL Hi-Fi Edition")
                .size(11)
                .color(colors::TEXT_MUTED),
            horizontal_space(),
            text("Pure Rust 2021").size(11).color(colors::TEXT_MUTED),
        ]
        .align_y(Alignment::Center),
    )
    .padding(16)
    .width(Length::Fill)
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

    let view_content = column![
        library_card,
        vertical_space().height(8),
        audio_engine_card,
        vertical_space().height(8),
        theme_card,
        vertical_space().height(8),
        shortcuts_card,
        vertical_space().height(8),
        about_card,
    ]
    .spacing(8)
    .padding(20);

    scrollable(view_content)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
