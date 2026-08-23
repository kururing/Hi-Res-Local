//! Reusable UI component styling and widgets for OLED-Dark TIDAL theme.

use crate::app::{Message, ScanProgress};
use crate::theme::{colors, layout};
use iced::border::Radius;
use iced::widget::{
    button, column, container, progress_bar, row, slider, text, text_input, tooltip,
};
use iced::{Alignment, Background, Border, Color, Element, Length, Shadow, Theme};
use std::borrow::Cow;

// ============================================================================
// Containers and Panels Styles
// ============================================================================

/// Root sidebar container style.
pub fn sidebar_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(colors::SURFACE_DEEP)),
        text_color: Some(colors::TEXT_PRIMARY),
        border: Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: Radius::default(),
        },
        shadow: Shadow::default(),
    }
}

/// Content header bar style.
pub fn header_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(colors::OLED_BLACK)),
        text_color: Some(colors::TEXT_PRIMARY),
        border: Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: Radius::default(),
        },
        shadow: Shadow::default(),
    }
}

/// Bottom fixed player bar container style.
pub fn player_bar_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(colors::SURFACE_DEEP)),
        text_color: Some(colors::TEXT_PRIMARY),
        border: Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: Radius::default(),
        },
        shadow: Shadow::default(),
    }
}

/// Elevated card container style.
pub fn card_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(colors::SURFACE_PANEL)),
        text_color: Some(colors::TEXT_PRIMARY),
        border: Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_MD),
        },
        shadow: Shadow::default(),
    }
}

/// Elevated card hover container style.
pub fn card_hover_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(colors::SURFACE_ELEVATED)),
        text_color: Some(colors::TEXT_PRIMARY),
        border: Border {
            color: colors::BORDER_FOCUS,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_MD),
        },
        shadow: Shadow::default(),
    }
}

/// Hero card container style for Now Playing view.
pub fn hero_card_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(colors::SURFACE_PANEL)),
        text_color: Some(colors::TEXT_PRIMARY),
        border: Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_LG),
        },
        shadow: Shadow::default(),
    }
}

/// Badge container style.
pub fn badge_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(colors::SURFACE_ELEVATED)),
        text_color: Some(colors::TEXT_SECONDARY),
        border: Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_SM),
        },
        shadow: Shadow::default(),
    }
}

/// Accent emerald badge style.
pub fn badge_accent_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(colors::ACCENT_MUTED)),
        text_color: Some(colors::ACCENT_HOVER),
        border: Border {
            color: colors::ACCENT_PRIMARY,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_SM),
        },
        shadow: Shadow::default(),
    }
}

// ============================================================================
// Button Styles
// ============================================================================

/// Sidebar Navigation item button style.
pub fn nav_button_style(is_active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let (bg, text_color, border_color) = if is_active {
            (
                colors::SURFACE_ELEVATED,
                colors::TEXT_PRIMARY,
                colors::ACCENT_PRIMARY,
            )
        } else {
            match status {
                button::Status::Hovered => (
                    colors::SURFACE_HOVER,
                    colors::TEXT_PRIMARY,
                    Color::TRANSPARENT,
                ),
                button::Status::Pressed => (
                    colors::SURFACE_PANEL,
                    colors::TEXT_PRIMARY,
                    Color::TRANSPARENT,
                ),
                _ => (
                    Color::TRANSPARENT,
                    colors::TEXT_SECONDARY,
                    Color::TRANSPARENT,
                ),
            }
        };

        button::Style {
            background: Some(Background::Color(bg)),
            text_color,
            border: Border {
                color: border_color,
                width: if is_active { 1.5 } else { 0.0 },
                radius: Radius::from(layout::RADIUS_MD),
            },
            shadow: Shadow::default(),
        }
    }
}

/// Primary accent button style (Emerald green CTA).
pub fn primary_button_style(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => colors::ACCENT_HOVER,
        button::Status::Pressed => colors::ACCENT_MUTED,
        button::Status::Disabled => colors::SURFACE_PANEL,
        _ => colors::ACCENT_PRIMARY,
    };

    button::Style {
        background: Some(Background::Color(bg)),
        text_color: colors::OLED_BLACK,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: Radius::from(layout::RADIUS_MD),
        },
        shadow: Shadow::default(),
    }
}

/// Secondary outlined button style.
pub fn secondary_button_style(_theme: &Theme, status: button::Status) -> button::Style {
    let (bg, border_color) = match status {
        button::Status::Hovered => (colors::SURFACE_HOVER, colors::BORDER_FOCUS),
        button::Status::Pressed => (colors::SURFACE_PANEL, colors::BORDER_SUBTLE),
        _ => (colors::SURFACE_PANEL, colors::BORDER_SUBTLE),
    };

    button::Style {
        background: Some(Background::Color(bg)),
        text_color: colors::TEXT_PRIMARY,
        border: Border {
            color: border_color,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_MD),
        },
        shadow: Shadow::default(),
    }
}

/// Danger action button style (e.g. Delete).
pub fn danger_button_style(_theme: &Theme, status: button::Status) -> button::Style {
    let (bg, text_color) = match status {
        button::Status::Hovered => (colors::STATUS_DANGER, colors::TEXT_PRIMARY),
        _ => (colors::SURFACE_PANEL, colors::STATUS_DANGER),
    };

    button::Style {
        background: Some(Background::Color(bg)),
        text_color,
        border: Border {
            color: colors::STATUS_DANGER,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_SM),
        },
        shadow: Shadow::default(),
    }
}

/// Circular play button in bottom player or hero cards.
pub fn circular_play_button_style(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => colors::ACCENT_HOVER,
        button::Status::Pressed => colors::ACCENT_MUTED,
        _ => colors::ACCENT_PRIMARY,
    };

    button::Style {
        background: Some(Background::Color(bg)),
        text_color: colors::OLED_BLACK,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: Radius::from(layout::RADIUS_FULL),
        },
        shadow: Shadow::default(),
    }
}

/// Compact icon control button style with active toggle coloring.
pub fn icon_control_button_style(
    is_active: bool,
) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let (bg, text_color) = if is_active {
            (colors::ACCENT_MUTED, colors::ACCENT_HOVER)
        } else {
            match status {
                button::Status::Hovered => (colors::SURFACE_HOVER, colors::TEXT_PRIMARY),
                button::Status::Pressed => (colors::SURFACE_PANEL, colors::TEXT_PRIMARY),
                _ => (Color::TRANSPARENT, colors::TEXT_SECONDARY),
            }
        };

        button::Style {
            background: Some(Background::Color(bg)),
            text_color,
            border: Border {
                color: if is_active {
                    colors::ACCENT_PRIMARY
                } else {
                    Color::TRANSPARENT
                },
                width: if is_active { 1.0 } else { 0.0 },
                radius: Radius::from(layout::RADIUS_MD),
            },
            shadow: Shadow::default(),
        }
    }
}

/// Track row button style (table row).
pub fn track_row_button_style(
    is_selected: bool,
    is_playing: bool,
) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let (bg, border_color) = if is_playing {
            (colors::SURFACE_ELEVATED, colors::ACCENT_MUTED)
        } else if is_selected {
            (colors::SURFACE_PANEL, colors::BORDER_FOCUS)
        } else {
            match status {
                button::Status::Hovered => (colors::SURFACE_HOVER, colors::BORDER_SUBTLE),
                button::Status::Pressed => (colors::SURFACE_ELEVATED, colors::BORDER_SUBTLE),
                _ => (Color::TRANSPARENT, Color::TRANSPARENT),
            }
        };

        button::Style {
            background: Some(Background::Color(bg)),
            text_color: if is_playing {
                colors::ACCENT_PRIMARY
            } else {
                colors::TEXT_PRIMARY
            },
            border: Border {
                color: border_color,
                width: if is_playing || is_selected { 1.0 } else { 0.0 },
                radius: Radius::from(layout::RADIUS_MD),
            },
            shadow: Shadow::default(),
        }
    }
}

// ============================================================================
// Input & Slider Styles
// ============================================================================

/// Search input box style.
pub fn search_input_style(_theme: &Theme, status: text_input::Status) -> text_input::Style {
    let (bg, border_color) = match status {
        text_input::Status::Focused => (colors::SURFACE_PANEL, colors::ACCENT_PRIMARY),
        text_input::Status::Hovered => (colors::SURFACE_PANEL, colors::BORDER_FOCUS),
        _ => (colors::SURFACE_PANEL, colors::BORDER_SUBTLE),
    };

    text_input::Style {
        background: Background::Color(bg),
        border: Border {
            color: border_color,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_FULL),
        },
        icon: colors::TEXT_MUTED,
        placeholder: colors::TEXT_MUTED,
        value: colors::TEXT_PRIMARY,
        selection: colors::ACCENT_MUTED,
    }
}

/// Generic text input box style.
pub fn standard_input_style(_theme: &Theme, status: text_input::Status) -> text_input::Style {
    let (bg, border_color) = match status {
        text_input::Status::Focused => (colors::SURFACE_PANEL, colors::ACCENT_PRIMARY),
        text_input::Status::Hovered => (colors::SURFACE_PANEL, colors::BORDER_FOCUS),
        _ => (colors::SURFACE_PANEL, colors::BORDER_SUBTLE),
    };

    text_input::Style {
        background: Background::Color(bg),
        border: Border {
            color: border_color,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_MD),
        },
        icon: colors::TEXT_MUTED,
        placeholder: colors::TEXT_MUTED,
        value: colors::TEXT_PRIMARY,
        selection: colors::ACCENT_MUTED,
    }
}

/// Sleek seek progress slider style.
pub fn seek_slider_style(_theme: &Theme, status: slider::Status) -> slider::Style {
    let (rail_active, handle_color) = match status {
        slider::Status::Hovered | slider::Status::Dragged => {
            (colors::ACCENT_PRIMARY, colors::TEXT_PRIMARY)
        }
        _ => (colors::ACCENT_PRIMARY, colors::ACCENT_PRIMARY),
    };

    slider::Style {
        rail: slider::Rail {
            backgrounds: (
                Background::Color(rail_active),
                Background::Color(colors::SURFACE_HOVER),
            ),
            width: 4.0,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: Radius::from(layout::RADIUS_FULL),
            },
        },
        handle: slider::Handle {
            shape: slider::HandleShape::Circle { radius: 6.0 },
            background: Background::Color(handle_color),
            border_color: colors::SURFACE_DEEP,
            border_width: 1.5,
        },
    }
}

/// Volume slider style.
pub fn volume_slider_style(_theme: &Theme, status: slider::Status) -> slider::Style {
    let (rail_active, handle_color) = match status {
        slider::Status::Hovered | slider::Status::Dragged => {
            (colors::TEXT_PRIMARY, colors::TEXT_PRIMARY)
        }
        _ => (colors::TEXT_SECONDARY, colors::TEXT_SECONDARY),
    };

    slider::Style {
        rail: slider::Rail {
            backgrounds: (
                Background::Color(rail_active),
                Background::Color(colors::SURFACE_HOVER),
            ),
            width: 4.0,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: Radius::from(layout::RADIUS_FULL),
            },
        },
        handle: slider::Handle {
            shape: slider::HandleShape::Circle { radius: 5.0 },
            background: Background::Color(handle_color),
            border_color: colors::SURFACE_DEEP,
            border_width: 1.0,
        },
    }
}

/// Custom scanning progress bar style.
pub fn scan_progress_bar_style(_theme: &Theme) -> progress_bar::Style {
    progress_bar::Style {
        background: Background::Color(colors::SURFACE_HOVER),
        bar: Background::Color(colors::ACCENT_PRIMARY),
        border: Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: Radius::from(layout::RADIUS_FULL),
        },
    }
}

// ============================================================================
// Reusable Composite Widgets
// ============================================================================

/// Renders a styled badge pill.
pub fn badge<'a>(label: impl Into<Cow<'a, str>>, is_accent: bool) -> Element<'a, Message> {
    let style_fn = if is_accent {
        badge_accent_style
    } else {
        badge_style
    };

    let text_color = if is_accent {
        colors::ACCENT_HOVER
    } else {
        colors::TEXT_MUTED
    };

    container(text(label.into()).size(11).color(text_color))
        .style(style_fn)
        .padding([2, 8])
        .into()
}

/// Renders an album or track artwork placeholder with initial glyph.
pub fn artwork_placeholder<'a>(title: &str, size: f32) -> Element<'a, Message> {
    let initial = title
        .chars()
        .next()
        .unwrap_or('♪')
        .to_uppercase()
        .to_string();

    container(
        text(initial)
            .size((size * 0.45).max(12.0))
            .color(colors::TEXT_MUTED),
    )
    .width(Length::Fixed(size))
    .height(Length::Fixed(size))
    .center_x(Length::Fixed(size))
    .center_y(Length::Fixed(size))
    .style(move |_theme| container::Style {
        background: Some(Background::Color(colors::SURFACE_ELEVATED)),
        text_color: Some(colors::TEXT_MUTED),
        border: Border {
            color: colors::BORDER_SUBTLE,
            width: 1.0,
            radius: Radius::from(if size > 64.0 {
                layout::RADIUS_LG
            } else {
                layout::RADIUS_MD
            }),
        },
        shadow: Shadow::default(),
    })
    .into()
}

/// Renders a full empty state panel with icon, title, description, and optional action button.
pub fn empty_state<'a>(
    icon: impl Into<Cow<'a, str>>,
    title: impl Into<Cow<'a, str>>,
    description: impl Into<Cow<'a, str>>,
    action: Option<Element<'a, Message>>,
) -> Element<'a, Message> {
    let mut content = column![
        text(icon.into()).size(48).color(colors::ACCENT_MUTED),
        text(title.into()).size(22).color(colors::TEXT_PRIMARY),
        text(description.into()).size(14).color(colors::TEXT_MUTED),
    ]
    .spacing(12)
    .align_x(Alignment::Center);

    if let Some(act) = action {
        content = content.push(act);
    }

    container(content)
        .width(Length::Fill)
        .center_x(Length::Fill)
        .center_y(Length::Shrink)
        .padding(48)
        .into()
}

/// Renders an active scan progress banner when a directory is being scanned.
pub fn scanning_banner<'a>(progress: &ScanProgress) -> Element<'a, Message> {
    let total = progress.total_files.max(1) as f32;
    let current = progress.scanned_files as f32;
    let fraction = (current / total).clamp(0.0, 1.0);
    let percentage = (fraction * 100.0) as u32;

    let path_label = progress
        .current_path
        .as_ref()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Indexing audio files...".to_string());

    let content = column![
        row![
            text("⚡ Scanning Audio Library...")
                .size(13)
                .color(colors::ACCENT_PRIMARY),
            text(format!(
                "{} / {} files ({}%)",
                progress.scanned_files, progress.total_files, percentage
            ))
            .size(12)
            .color(colors::TEXT_SECONDARY),
        ]
        .spacing(12)
        .align_y(Alignment::Center),
        progress_bar(0.0..=1.0, fraction)
            .height(Length::Fixed(4.0))
            .style(scan_progress_bar_style),
        text(format!("Current: {}", path_label))
            .size(11)
            .color(colors::TEXT_MUTED),
    ]
    .spacing(6);

    container(content)
        .padding([8, 16])
        .width(Length::Fill)
        .style(|_theme| container::Style {
            background: Some(Background::Color(colors::SURFACE_PANEL)),
            text_color: Some(colors::TEXT_PRIMARY),
            border: Border {
                color: colors::ACCENT_MUTED,
                width: 1.0,
                radius: Radius::from(layout::RADIUS_MD),
            },
            shadow: Shadow::default(),
        })
        .into()
}

/// Creates an accessible tooltip wrapping a widget.
pub fn with_tooltip<'a>(
    content: impl Into<Element<'a, Message>>,
    tip: &'a str,
) -> Element<'a, Message> {
    tooltip(
        content,
        container(text(tip).size(12).color(colors::TEXT_PRIMARY))
            .padding([4, 8])
            .style(|_theme| container::Style {
                background: Some(Background::Color(colors::SURFACE_ELEVATED)),
                text_color: Some(colors::TEXT_PRIMARY),
                border: Border {
                    color: colors::BORDER_FOCUS,
                    width: 1.0,
                    radius: Radius::from(layout::RADIUS_SM),
                },
                shadow: Shadow::default(),
            }),
        tooltip::Position::Top,
    )
    .gap(6.0)
    .into()
}
