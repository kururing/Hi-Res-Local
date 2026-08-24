# Nghe Nhạc Pro Max 🎵

High-performance, local-only desktop music player built with **Tauri 2**, **Rust**, **React 19**, and **Tailwind CSS**.

## Features

- **100% Local-First & Private**: No cloud accounts, tracking, or remote server dependencies. All playback and library management stay strictly on your machine.
- **High-Fidelity Audio Engine**:
  - Symphonia & CPAL native playback pipeline.
  - Bit-perfect output support & output device selection.
  - Gapless transitions & crossfade support (Equal-Power curve).
  - 10-Band Graphic Equalizer with DSP biquad filtering and presets.
  - EBU R128 / ReplayGain normalisation with peak clipping prevention.
- **Comprehensive Library Management**:
  - Embedded SQLite database with automatic migrations and indexing.
  - Live directory watching via `notify`.
  - Lofty-powered metadata tag reading and writing.
  - Smart playlists, dynamic filtering, duplicate detection, and M3U import/export.
  - Synchronized and plain text LRC lyrics parsing and display.

## Architecture

```text
nghenhacpromax/
├── src-tauri/             # Tauri 2 Desktop Core (Rust)
│   ├── src/
│   │   ├── audio/         # Native audio engine (CPAL, Symphonia, DSP, Gapless)
│   │   ├── commands/      # Tauri IPC command handlers
│   │   ├── db/            # SQLite schema, migrations, queries
│   │   ├── scanner/       # Folder scanning, directory watcher, cover cache
│   │   ├── tags/          # ID3/FLAC tag reading & writing
│   │   ├── lyrics/        # LRC parser & manager
│   │   └── models/        # Rust domain models and DTOs
│   └── tauri.conf.json    # Tauri application configuration
├── web/                   # Frontend UI (React 19, TypeScript, Vite, Tailwind)
│   ├── src/
│   │   ├── components/    # UI views, player controls, sidebar, modals
│   │   ├── services/      # Typed Tauri IPC bindings & event listeners
│   │   └── types/         # Domain TypeScript models matching Rust DTOs
├── scripts/               # Tauri launcher and Windows build environment setup
├── package.json           # Root development commands and Tauri CLI
└── README.md
```

## Getting Started

### Prerequisites

- **Node.js**: v18+ and `npm`
- **Rust**: edition 2021 (MSRV 1.80+)
- **Windows / macOS / Linux**: C++ Build Tools & Platform SDK

### Development

Run the frontend and Tauri desktop application together in development mode:

```bash
# Install root (Tauri CLI) and frontend dependencies
npm ci
npm --prefix web ci

# Start Tauri development app
npm run tauri:dev
```

Or run frontend standalone in browser for UI rapid prototyping:

```bash
npm run dev
```

### Discord Rich Presence

The app includes its public Discord Application ID. To override it for another Discord application, expose a different ID while developing or building:

```powershell
$env:NGHENHAC_DISCORD_CLIENT_ID = "your-discord-application-id"
npm run tauri:dev
```

The **Show activity on Discord** switch is available under Desktop App Behavior. Discord must be running when the switch is enabled.

### Verification & Testing

```bash
# Frontend tests and type checks
npm run test
npm run typecheck
npm run build

# Rust backend tests
cd src-tauri
cargo check
cargo test
cargo fmt --check
```

