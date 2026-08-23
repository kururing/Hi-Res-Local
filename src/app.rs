//! Core application state, public domain models, and message contracts.
//!
//! This module defines the shared public contracts and interfaces so that
//! Library, Audio, and UI feature workers can implement their respective
//! modules independently without modifying shared scaffold files.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

// ============================================================================
// Public Domain Types & Identifiers
// ============================================================================

/// Unique identifier for a track in the library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct TrackId(pub Uuid);

impl TrackId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for TrackId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for TrackId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Unique identifier for a user playlist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PlaylistId(pub Uuid);

impl PlaylistId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for PlaylistId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for PlaylistId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Audio metadata and file information for a single music track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: TrackId,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: Duration,
    pub path: PathBuf,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub sample_rate: Option<u32>,
    pub bitrate: Option<u32>,
    pub channels: Option<u16>,
    pub date_added: chrono::DateTime<chrono::Utc>,
}

impl Default for Track {
    fn default() -> Self {
        Self {
            id: TrackId::new(),
            title: "Unknown Title".to_string(),
            artist: "Unknown Artist".to_string(),
            album: "Unknown Album".to_string(),
            duration: Duration::ZERO,
            path: PathBuf::new(),
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            sample_rate: None,
            bitrate: None,
            channels: None,
            date_added: chrono::Utc::now(),
        }
    }
}

/// User-created or imported playlist.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Playlist {
    pub id: PlaylistId,
    pub name: String,
    pub description: Option<String>,
    pub track_ids: Vec<TrackId>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Current playback state of the audio player engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum PlaybackState {
    #[default]
    Stopped,
    Playing,
    Paused,
    Loading,
}

/// Repetition mode for playback queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum LoopMode {
    #[default]
    Off,
    Track,
    Playlist,
}

/// Comprehensive playback status snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackStatus {
    pub state: PlaybackState,
    pub current_track: Option<Track>,
    pub position: Duration,
    pub duration: Duration,
    pub volume: f32,
    pub is_muted: bool,
    pub loop_mode: LoopMode,
    pub shuffle: bool,
}

impl Default for PlaybackStatus {
    fn default() -> Self {
        Self {
            state: PlaybackState::Stopped,
            current_track: None,
            position: Duration::ZERO,
            duration: Duration::ZERO,
            volume: 1.0,
            is_muted: false,
            loop_mode: LoopMode::Off,
            shuffle: false,
        }
    }
}

/// Progress metrics reported during directory scanning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScanProgress {
    pub total_files: usize,
    pub scanned_files: usize,
    pub current_path: Option<PathBuf>,
}

/// High-level library summary statistics.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LibraryStats {
    pub total_tracks: usize,
    pub total_artists: usize,
    pub total_albums: usize,
    pub total_duration_secs: u64,
}

/// Navigation views available in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ViewMode {
    #[default]
    Tracks,
    Artists,
    Albums,
    Playlists,
    NowPlaying,
    Settings,
}

// ============================================================================
// Public Worker Trait Contracts
// ============================================================================

/// Public contract for the library scanning, metadata indexing, and SQLite persistence worker.
pub trait LibraryBackend: Send + Sync {
    /// Initializes database schema and runs initial integrity checks.
    fn initialize(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;

    /// Recursively scans a local filesystem directory for audio files and extracts metadata.
    fn scan_directory(
        &self,
        path: &Path,
    ) -> Result<Vec<Track>, Box<dyn std::error::Error + Send + Sync>>;

    /// Retrieves all indexed tracks from the database.
    fn get_all_tracks(&self) -> Result<Vec<Track>, Box<dyn std::error::Error + Send + Sync>>;

    /// Retrieves a single track by its unique ID.
    fn get_track_by_id(
        &self,
        id: &TrackId,
    ) -> Result<Option<Track>, Box<dyn std::error::Error + Send + Sync>>;

    /// Retrieves all user playlists.
    fn get_playlists(&self) -> Result<Vec<Playlist>, Box<dyn std::error::Error + Send + Sync>>;

    /// Computes summary statistics for the indexed library.
    fn get_stats(&self) -> LibraryStats;
}

/// Public contract for native audio playback engine and output streams.
pub trait AudioBackend: Send + Sync {
    /// Loads and begins playback of the specified track.
    fn play(&mut self, track: &Track) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;

    /// Pauses active playback.
    fn pause(&mut self);

    /// Resumes paused playback.
    fn resume(&mut self);

    /// Stops playback and resets position to the beginning.
    fn stop(&mut self);

    /// Seeks playback position to the given duration offset.
    fn seek(&mut self, position: Duration) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;

    /// Sets playback volume in range [0.0, 1.0].
    fn set_volume(&mut self, volume: f32);

    /// Sets the repeat / loop mode.
    fn set_loop_mode(&mut self, mode: LoopMode);

    /// Toggles or sets shuffle mode.
    fn set_shuffle(&mut self, shuffle: bool);

    /// Returns a snapshot of current playback status.
    fn get_status(&self) -> PlaybackStatus;
}

// ============================================================================
// Application Message Bus
// ============================================================================

/// Global message enum handled by the Iced runtime and worker modules.
#[derive(Debug, Clone)]
pub enum Message {
    // Navigation & UI
    SelectView(ViewMode),
    SearchQueryChanged(String),
    SelectTrack(Option<TrackId>),
    SelectPlaylist(Option<PlaylistId>),

    // Library Operations
    OpenFolderDialog,
    DirectorySelected(Option<PathBuf>),
    ScanProgressUpdated(ScanProgress),
    ScanFinished(Result<Vec<Track>, String>),
    TracksLoaded(Vec<Track>),
    PlaylistsLoaded(Vec<Playlist>),
    CreatePlaylist(String),
    DeletePlaylist(PlaylistId),
    AddTrackToPlaylist {
        playlist_id: PlaylistId,
        track_id: TrackId,
    },
    RemoveTrackFromPlaylist {
        playlist_id: PlaylistId,
        track_id: TrackId,
    },

    // Audio Playback Controls
    PlayTrack(Track),
    PlayTrackById(TrackId),
    TogglePlayPause,
    Pause,
    Resume,
    Stop,
    NextTrack,
    PreviousTrack,
    Seek(Duration),
    SetVolume(f32),
    ToggleMute,
    SetLoopMode(LoopMode),
    ToggleShuffle,

    // Audio Events from Player Thread / Stream
    AudioPositionUpdated(Duration),
    AudioStateChanged(PlaybackState),
    AudioTrackEnded,
    AudioError(String),

    // Periodic UI / Animation Tick
    Tick,
}

// ============================================================================
// Top-level Application State
// ============================================================================

/// Main application state struct managed by Iced.
pub struct App {
    pub active_view: ViewMode,
    pub search_query: String,
    pub selected_track_id: Option<TrackId>,
    pub selected_playlist_id: Option<PlaylistId>,
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub playback_status: PlaybackStatus,
    pub scan_progress: Option<ScanProgress>,
}

impl Default for App {
    fn default() -> Self {
        Self {
            active_view: ViewMode::Tracks,
            search_query: String::new(),
            selected_track_id: None,
            selected_playlist_id: None,
            tracks: Vec::new(),
            playlists: Vec::new(),
            playback_status: PlaybackStatus::default(),
            scan_progress: None,
        }
    }
}

impl App {
    pub fn new() -> (Self, iced::Task<Message>) {
        (Self::default(), iced::Task::none())
    }

    pub fn title(&self) -> String {
        match &self.playback_status.current_track {
            Some(track) => format!("{} - {} | Nghe Nhac Pro Max", track.title, track.artist),
            None => "Nghe Nhac Pro Max".to_string(),
        }
    }

    pub fn update(&mut self, message: Message) -> iced::Task<Message> {
        match message {
            Message::SelectView(view) => {
                self.active_view = view;
            }
            Message::SearchQueryChanged(query) => {
                self.search_query = query;
            }
            Message::SelectTrack(id) => {
                self.selected_track_id = id;
            }
            Message::SelectPlaylist(id) => {
                self.selected_playlist_id = id;
            }
            Message::OpenFolderDialog => {
                // Placeholder: will trigger native file dialog task
            }
            Message::DirectorySelected(path) => {
                tracing::info!("Selected directory for scan: {:?}", path);
            }
            Message::ScanProgressUpdated(progress) => {
                self.scan_progress = Some(progress);
            }
            Message::ScanFinished(result) => {
                self.scan_progress = None;
                if let Ok(tracks) = result {
                    self.tracks = tracks;
                }
            }
            Message::TracksLoaded(tracks) => {
                self.tracks = tracks;
            }
            Message::PlaylistsLoaded(playlists) => {
                self.playlists = playlists;
            }
            Message::CreatePlaylist(name) => {
                tracing::info!("Creating playlist: {}", name);
            }
            Message::DeletePlaylist(id) => {
                self.playlists.retain(|p| p.id != id);
            }
            Message::AddTrackToPlaylist {
                playlist_id,
                track_id,
            } => {
                if let Some(pl) = self.playlists.iter_mut().find(|p| p.id == playlist_id) {
                    if !pl.track_ids.contains(&track_id) {
                        pl.track_ids.push(track_id);
                    }
                }
            }
            Message::RemoveTrackFromPlaylist {
                playlist_id,
                track_id,
            } => {
                if let Some(pl) = self.playlists.iter_mut().find(|p| p.id == playlist_id) {
                    pl.track_ids.retain(|&id| id != track_id);
                }
            }
            Message::PlayTrack(track) => {
                self.playback_status.current_track = Some(track);
                self.playback_status.state = PlaybackState::Playing;
            }
            Message::PlayTrackById(id) => {
                if let Some(track) = self.tracks.iter().find(|t| t.id == id).cloned() {
                    self.playback_status.current_track = Some(track);
                    self.playback_status.state = PlaybackState::Playing;
                }
            }
            Message::TogglePlayPause => match self.playback_status.state {
                PlaybackState::Playing => self.playback_status.state = PlaybackState::Paused,
                PlaybackState::Paused => self.playback_status.state = PlaybackState::Playing,
                _ => {}
            },
            Message::Pause => {
                if self.playback_status.state == PlaybackState::Playing {
                    self.playback_status.state = PlaybackState::Paused;
                }
            }
            Message::Resume => {
                if self.playback_status.state == PlaybackState::Paused {
                    self.playback_status.state = PlaybackState::Playing;
                }
            }
            Message::Stop => {
                self.playback_status.state = PlaybackState::Stopped;
                self.playback_status.position = Duration::ZERO;
            }
            Message::NextTrack => {
                tracing::info!("Next track requested");
            }
            Message::PreviousTrack => {
                tracing::info!("Previous track requested");
            }
            Message::Seek(position) => {
                self.playback_status.position = position;
            }
            Message::SetVolume(vol) => {
                self.playback_status.volume = vol.clamp(0.0, 1.0);
            }
            Message::ToggleMute => {
                self.playback_status.is_muted = !self.playback_status.is_muted;
            }
            Message::SetLoopMode(mode) => {
                self.playback_status.loop_mode = mode;
            }
            Message::ToggleShuffle => {
                self.playback_status.shuffle = !self.playback_status.shuffle;
            }
            Message::AudioPositionUpdated(pos) => {
                self.playback_status.position = pos;
            }
            Message::AudioStateChanged(state) => {
                self.playback_status.state = state;
            }
            Message::AudioTrackEnded => {
                tracing::info!("Track playback finished");
            }
            Message::AudioError(err) => {
                tracing::error!("Audio engine error: {}", err);
            }
            Message::Tick => {}
        }

        iced::Task::none()
    }

    pub fn view(&self) -> iced::Element<'_, Message> {
        crate::ui::render(self)
    }

    pub fn theme(&self) -> iced::Theme {
        crate::theme::oled_dark_theme()
    }

    pub fn subscription(&self) -> iced::Subscription<Message> {
        iced::Subscription::none()
    }
}
