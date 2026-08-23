# Nghe Nhac Pro Max

High-performance native desktop music player built in Rust using [Iced](https://github.com/iced-rs/iced).

## Architecture

The project is structured into modular layers designed for independent development:

- **`src/app.rs`**: Shared domain models (`Track`, `Playlist`, `PlaybackStatus`), application state (`App`), message bus (`Message`), and backend traits (`LibraryBackend`, `AudioBackend`).
- **`src/theme.rs`**: OLED-dark theme palette tokens, layout dimensions, and styling helpers.
- **`src/library/`**: Local audio file scanner, metadata extraction (`lofty`), and SQLite storage (`rusqlite`).
- **`src/audio/`**: Native playback engine and audio decoding stream (`rodio`, `symphonia`).
- **`src/ui/`**: User interface components, views, sidebar navigation, and player controls (`iced`).

## Getting Started

### Prerequisites

- Rust (edition 2021, MSRV 1.80+)
- Cargo

### Running

```bash
cargo run
```

### Checking and Formatting

```bash
cargo check
cargo fmt --check
```
