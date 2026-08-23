#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

//! Native desktop music player entry point.

pub mod app;
pub mod audio;
pub mod library;
pub mod theme;
pub mod ui;

use app::App;
use iced::window;
use iced::Size;

fn app_icon() -> window::Icon {
    let image = image::load_from_memory(include_bytes!("../assets/app-icon.png"))
        .expect("embedded app icon must be a valid PNG")
        .into_rgba8();
    let (width, height) = image.dimensions();

    window::icon::from_rgba(image.into_raw(), width, height)
        .expect("embedded app icon must contain valid RGBA pixels")
}

pub fn main() -> iced::Result {
    // Initialize logging subscriber
    tracing_subscriber::fmt::init();

    tracing::info!("Starting Nghe Nhac Pro Max desktop client");

    // Launch native Iced window
    iced::application(App::title, App::update, App::view)
        .window(window::Settings {
            size: Size::new(1200.0, 800.0),
            min_size: Some(Size::new(800.0, 600.0)),
            position: window::Position::Centered,
            icon: Some(app_icon()),
            ..Default::default()
        })
        .theme(App::theme)
        .subscription(App::subscription)
        .run_with(App::new)
}
