//! OLED-dark theme configuration and color palette tokens for the music player.

use iced::theme::Palette;
use iced::Theme;

/// Pure OLED Dark color constants.
pub mod colors {
    use iced::Color;

    // True OLED Blacks and deep dark surfaces
    pub const OLED_BLACK: Color = Color::from_rgb(0.0, 0.0, 0.0);
    pub const SURFACE_DEEP: Color = Color::from_rgb(0.04, 0.04, 0.04);
    pub const SURFACE_PANEL: Color = Color::from_rgb(0.07, 0.07, 0.07);
    pub const SURFACE_ELEVATED: Color = Color::from_rgb(0.10, 0.10, 0.10);
    pub const SURFACE_HOVER: Color = Color::from_rgb(0.15, 0.15, 0.15);

    // Subtle borders and dividers
    pub const BORDER_SUBTLE: Color = Color::from_rgb(0.14, 0.14, 0.14);
    pub const BORDER_FOCUS: Color = Color::from_rgb(0.25, 0.25, 0.25);

    // Accent Colors
    pub const ACCENT_PRIMARY: Color = Color::from_rgb(0.12, 0.84, 0.45); // Electric Emerald / Music Green
    pub const ACCENT_HOVER: Color = Color::from_rgb(0.16, 0.95, 0.52);
    pub const ACCENT_MUTED: Color = Color::from_rgb(0.08, 0.45, 0.26);

    // Text & Content Hierarchy
    pub const TEXT_PRIMARY: Color = Color::from_rgb(0.98, 0.98, 0.98);
    pub const TEXT_SECONDARY: Color = Color::from_rgb(0.65, 0.65, 0.68);
    pub const TEXT_MUTED: Color = Color::from_rgb(0.40, 0.40, 0.43);

    // Semantic status colors
    pub const STATUS_SUCCESS: Color = Color::from_rgb(0.12, 0.84, 0.45);
    pub const STATUS_WARNING: Color = Color::from_rgb(0.96, 0.62, 0.15);
    pub const STATUS_DANGER: Color = Color::from_rgb(0.94, 0.27, 0.27);
}

/// Layout spacing and dimension tokens.
pub mod layout {
    pub const SPACING_XS: f32 = 4.0;
    pub const SPACING_SM: f32 = 8.0;
    pub const SPACING_MD: f32 = 16.0;
    pub const SPACING_LG: f32 = 24.0;
    pub const SPACING_XL: f32 = 32.0;

    pub const RADIUS_SM: f32 = 4.0;
    pub const RADIUS_MD: f32 = 8.0;
    pub const RADIUS_LG: f32 = 12.0;
    pub const RADIUS_FULL: f32 = 999.0;

    pub const SIDEBAR_WIDTH: f32 = 240.0;
    pub const PLAYER_BAR_HEIGHT: f32 = 88.0;
}

/// Builds the custom OLED Dark palette.
pub fn oled_dark_palette() -> Palette {
    Palette {
        background: colors::OLED_BLACK,
        text: colors::TEXT_PRIMARY,
        primary: colors::ACCENT_PRIMARY,
        success: colors::STATUS_SUCCESS,
        danger: colors::STATUS_DANGER,
    }
}

/// Returns the default OLED Dark theme.
pub fn oled_dark_theme() -> Theme {
    Theme::custom("OLED Dark".to_string(), oled_dark_palette())
}
