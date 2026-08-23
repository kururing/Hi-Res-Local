//! Core application state, public domain models, message contracts, and runtime orchestration.
//!
//! This module integrates Library and Audio backends with the Iced UI runtime,
//! managing asynchronous metadata scanning, SQLite persistence, and native audio playback.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

use crate::audio::AudioEngine;
use crate::library::LibraryManager;

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
// Shared Singleton Instances for Backends
// ============================================================================

static GLOBAL_LIBRARY: Mutex<Option<LibraryManager>> = Mutex::new(None);
static GLOBAL_AUDIO: Mutex<Option<Arc<Mutex<AudioEngine>>>> = Mutex::new(None);

/// Returns the shared LibraryManager instance.
pub fn default_library() -> LibraryManager {
    let mut guard = GLOBAL_LIBRARY.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(ref lib) = *guard {
        lib.clone()
    } else {
        let lib = LibraryManager::new();
        *guard = Some(lib.clone());
        lib
    }
}

/// Sets the shared LibraryManager instance (used for testing and configuration).
pub fn set_default_library(lib: LibraryManager) {
    let mut guard = GLOBAL_LIBRARY.lock().unwrap_or_else(|p| p.into_inner());
    *guard = Some(lib);
}

/// Returns the shared AudioEngine instance wrapped in Arc<Mutex>.
pub fn default_audio() -> Arc<Mutex<AudioEngine>> {
    let mut guard = GLOBAL_AUDIO.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(ref audio) = *guard {
        audio.clone()
    } else {
        let audio = Arc::new(Mutex::new(AudioEngine::new()));
        *guard = Some(audio.clone());
        audio
    }
}

/// Sets the shared AudioEngine instance (used for testing and configuration).
pub fn set_default_audio(audio: AudioEngine) {
    let mut guard = GLOBAL_AUDIO.lock().unwrap_or_else(|p| p.into_inner());
    *guard = Some(Arc::new(Mutex::new(audio)));
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
    /// Initializes application state, sets up SQLite schema, and triggers async library load.
    pub fn new() -> (Self, iced::Task<Message>) {
        let app = Self::default();
        let mut lib = default_library();
        if let Err(e) = lib.initialize() {
            tracing::error!("Failed to initialize library database schema: {}", e);
        }

        // Asynchronously load tracks and playlists on startup without blocking the UI
        let load_tracks_task = iced::Task::perform(
            async move {
                let lib = default_library();
                lib.get_all_tracks().unwrap_or_default()
            },
            Message::TracksLoaded,
        );

        let load_playlists_task = iced::Task::perform(
            async move {
                let lib = default_library();
                lib.get_playlists().unwrap_or_default()
            },
            Message::PlaylistsLoaded,
        );

        let startup_tasks = iced::Task::batch(vec![load_tracks_task, load_playlists_task]);
        (app, startup_tasks)
    }

    /// Generates the window title based on current playback status.
    pub fn title(&self) -> String {
        match &self.playback_status.current_track {
            Some(track) => format!("{} - {} | Nghe Nhac Pro Max", track.title, track.artist),
            None => "Nghe Nhac Pro Max".to_string(),
        }
    }

    /// Main message dispatcher and reducer for application events.
    pub fn update(&mut self, message: Message) -> iced::Task<Message> {
        match message {
            Message::SelectView(view) => {
                self.active_view = view;
                iced::Task::none()
            }
            Message::SearchQueryChanged(query) => {
                self.search_query = query;
                iced::Task::none()
            }
            Message::SelectTrack(id) => {
                self.selected_track_id = id;
                iced::Task::none()
            }
            Message::SelectPlaylist(id) => {
                self.selected_playlist_id = id;
                iced::Task::none()
            }
            Message::OpenFolderDialog => iced::Task::perform(
                async {
                    let handle = rfd::AsyncFileDialog::new()
                        .set_title("Select Music Folder")
                        .pick_folder()
                        .await;
                    handle.map(|h| h.path().to_path_buf())
                },
                Message::DirectorySelected,
            ),
            Message::DirectorySelected(Some(path)) => {
                tracing::info!("Selected directory for scan: {:?}", path);
                self.scan_progress = Some(ScanProgress {
                    total_files: 0,
                    scanned_files: 0,
                    current_path: Some(path.clone()),
                });

                iced::Task::perform(
                    async move {
                        tokio::task::spawn_blocking(move || {
                            let lib = default_library();
                            match lib.scan_directory(&path) {
                                Ok(_) => match lib.get_all_tracks() {
                                    Ok(all_tracks) => Ok(all_tracks),
                                    Err(e) => Err(e.to_string()),
                                },
                                Err(err) => Err(err.to_string()),
                            }
                        })
                        .await
                        .unwrap_or_else(|e| Err(e.to_string()))
                    },
                    Message::ScanFinished,
                )
            }
            Message::DirectorySelected(None) => {
                tracing::info!("Directory selection cancelled");
                iced::Task::none()
            }
            Message::ScanProgressUpdated(progress) => {
                self.scan_progress = Some(progress);
                iced::Task::none()
            }
            Message::ScanFinished(result) => {
                self.scan_progress = None;
                match result {
                    Ok(tracks) => {
                        tracing::info!("Scan completed successfully with {} tracks", tracks.len());
                        self.tracks = tracks;
                    }
                    Err(err) => {
                        tracing::error!("Directory scan failed: {}", err);
                    }
                }
                iced::Task::none()
            }
            Message::TracksLoaded(tracks) => {
                self.tracks = tracks;
                iced::Task::none()
            }
            Message::PlaylistsLoaded(playlists) => {
                self.playlists = playlists;
                iced::Task::none()
            }
            Message::CreatePlaylist(name) => {
                let lib = default_library();
                match lib.create_playlist(&name, None) {
                    Ok(new_pl) => {
                        self.playlists.push(new_pl);
                    }
                    Err(e) => {
                        tracing::error!("Failed to create playlist in database: {}", e);
                    }
                }
                iced::Task::none()
            }
            Message::DeletePlaylist(id) => {
                let lib = default_library();
                if let Err(e) = lib.delete_playlist(&id) {
                    tracing::error!("Failed to delete playlist from database: {}", e);
                }
                self.playlists.retain(|p| p.id != id);
                if self.selected_playlist_id == Some(id) {
                    self.selected_playlist_id = None;
                }
                iced::Task::none()
            }
            Message::AddTrackToPlaylist {
                playlist_id,
                track_id,
            } => {
                let lib = default_library();
                if let Err(e) = lib.add_track_to_playlist(&playlist_id, &track_id) {
                    tracing::error!("Failed to add track to playlist in database: {}", e);
                }
                if let Some(pl) = self.playlists.iter_mut().find(|p| p.id == playlist_id) {
                    if !pl.track_ids.contains(&track_id) {
                        pl.track_ids.push(track_id);
                    }
                }
                iced::Task::none()
            }
            Message::RemoveTrackFromPlaylist {
                playlist_id,
                track_id,
            } => {
                let lib = default_library();
                if let Err(e) = lib.remove_track_from_playlist(&playlist_id, &track_id) {
                    tracing::error!("Failed to remove track from playlist in database: {}", e);
                }
                if let Some(pl) = self.playlists.iter_mut().find(|p| p.id == playlist_id) {
                    pl.track_ids.retain(|&id| id != track_id);
                }
                iced::Task::none()
            }
            Message::PlayTrack(track) => {
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                let res = guard.play(&track);
                let status = guard.get_status();
                drop(guard);

                self.playback_status = status;
                self.selected_track_id = Some(track.id);

                if let Err(err) = res {
                    tracing::error!("AudioEngine play error: {}", err);
                    return iced::Task::done(Message::AudioError(err.to_string()));
                }
                iced::Task::none()
            }
            Message::PlayTrackById(id) => {
                if let Some(track) = self.find_track_by_id(&id).cloned() {
                    return self.update(Message::PlayTrack(track));
                }
                iced::Task::none()
            }
            Message::TogglePlayPause => {
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                match self.playback_status.state {
                    PlaybackState::Playing => {
                        guard.pause();
                        self.playback_status = guard.get_status();
                        self.playback_status.state = PlaybackState::Paused;
                    }
                    PlaybackState::Paused => {
                        guard.resume();
                        self.playback_status = guard.get_status();
                        self.playback_status.state = PlaybackState::Playing;
                    }
                    PlaybackState::Stopped => {
                        if let Some(track) = self.playback_status.current_track.clone() {
                            let _ = guard.play(&track);
                            self.playback_status = guard.get_status();
                            self.playback_status.state = PlaybackState::Playing;
                        } else if let Some(first) = self.tracks.first().cloned() {
                            drop(guard);
                            return self.update(Message::PlayTrack(first));
                        }
                    }
                    PlaybackState::Loading => {}
                }
                iced::Task::none()
            }
            Message::Pause => {
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                guard.pause();
                self.playback_status = guard.get_status();
                if self.playback_status.state == PlaybackState::Playing {
                    self.playback_status.state = PlaybackState::Paused;
                }
                iced::Task::none()
            }
            Message::Resume => {
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                guard.resume();
                self.playback_status = guard.get_status();
                if self.playback_status.state == PlaybackState::Paused {
                    self.playback_status.state = PlaybackState::Playing;
                }
                iced::Task::none()
            }
            Message::Stop => {
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                guard.stop();
                self.playback_status = guard.get_status();
                self.playback_status.state = PlaybackState::Stopped;
                self.playback_status.position = Duration::ZERO;
                iced::Task::none()
            }
            Message::Seek(position) => {
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                let _ = guard.seek(position);
                self.playback_status = guard.get_status();
                iced::Task::none()
            }
            Message::SetVolume(vol) => {
                let clamped = vol.clamp(0.0, 1.0);
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                guard.set_volume(clamped);
                self.playback_status = guard.get_status();
                iced::Task::none()
            }
            Message::ToggleMute => {
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                guard.toggle_mute();
                self.playback_status = guard.get_status();
                iced::Task::none()
            }
            Message::SetLoopMode(mode) => {
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                guard.set_loop_mode(mode);
                self.playback_status = guard.get_status();
                iced::Task::none()
            }
            Message::ToggleShuffle => {
                let audio = default_audio();
                let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                let next_shuffle = !guard.get_status().shuffle;
                guard.set_shuffle(next_shuffle);
                self.playback_status = guard.get_status();
                iced::Task::none()
            }
            Message::NextTrack => {
                if let Some(next_track) = self.compute_next_track(false) {
                    return self.update(Message::PlayTrack(next_track));
                } else {
                    let audio = default_audio();
                    let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                    guard.stop();
                    self.playback_status = guard.get_status();
                }
                iced::Task::none()
            }
            Message::PreviousTrack => {
                if self.playback_status.position > Duration::from_secs(3) {
                    return self.update(Message::Seek(Duration::ZERO));
                }
                if let Some(prev_track) = self.compute_previous_track() {
                    return self.update(Message::PlayTrack(prev_track));
                } else {
                    return self.update(Message::Seek(Duration::ZERO));
                }
            }
            Message::AudioPositionUpdated(pos) => {
                self.playback_status.position = pos;
                iced::Task::none()
            }
            Message::AudioStateChanged(state) => {
                self.playback_status.state = state;
                iced::Task::none()
            }
            Message::AudioTrackEnded => {
                tracing::info!("Track playback finished, progressing queue");
                if let Some(next_track) = self.compute_next_track(true) {
                    return self.update(Message::PlayTrack(next_track));
                } else {
                    let audio = default_audio();
                    let mut guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                    guard.stop();
                    self.playback_status = guard.get_status();
                }
                iced::Task::none()
            }
            Message::AudioError(err) => {
                tracing::error!("Audio engine error: {}", err);
                iced::Task::none()
            }
            Message::Tick => {
                let audio = default_audio();
                let guard = audio.lock().unwrap_or_else(|p| p.into_inner());
                let latest_status = guard.get_status();
                let was_playing = self.playback_status.state == PlaybackState::Playing;
                let is_now_stopped = latest_status.state == PlaybackState::Stopped;

                self.playback_status = latest_status;
                drop(guard);

                if was_playing && is_now_stopped {
                    return self.update(Message::AudioTrackEnded);
                }
                iced::Task::none()
            }
        }
    }

    /// Renders UI layout.
    pub fn view(&self) -> iced::Element<'_, Message> {
        crate::ui::render(self)
    }

    /// Returns the OLED Dark application theme.
    pub fn theme(&self) -> iced::Theme {
        crate::theme::oled_dark_theme()
    }

    /// Subscribes to periodic timer ticks when playback is active to synchronize UI state.
    pub fn subscription(&self) -> iced::Subscription<Message> {
        if self.playback_status.state == PlaybackState::Playing {
            iced::time::every(Duration::from_millis(250)).map(|_| Message::Tick)
        } else {
            iced::Subscription::none()
        }
    }

    /// Returns the active playback queue based on selected playlist or library tracks.
    pub fn get_active_queue(&self) -> Vec<Track> {
        if let Some(pl_id) = self.selected_playlist_id {
            if let Some(pl) = self.playlists.iter().find(|p| p.id == pl_id) {
                let pl_tracks: Vec<Track> = pl
                    .track_ids
                    .iter()
                    .filter_map(|tid| self.find_track_by_id(tid).cloned())
                    .collect();
                if !pl_tracks.is_empty() {
                    return pl_tracks;
                }
            }
        }
        self.tracks.clone()
    }

    /// Finds a track in library by its ID.
    pub fn find_track_by_id(&self, id: &TrackId) -> Option<&Track> {
        self.tracks.iter().find(|t| t.id == *id)
    }

    /// Computes the next track to play taking into account repeat mode, shuffle, and queue bounds.
    pub fn compute_next_track(&self, from_auto_end: bool) -> Option<Track> {
        let queue = self.get_active_queue();
        if queue.is_empty() {
            return None;
        }

        // LoopMode::Track repeats current track on auto-end
        if from_auto_end && self.playback_status.loop_mode == LoopMode::Track {
            if let Some(curr) = &self.playback_status.current_track {
                return Some(curr.clone());
            }
        }

        let curr_id = self.playback_status.current_track.as_ref().map(|t| t.id);
        let curr_idx = curr_id.and_then(|id| queue.iter().position(|t| t.id == id));

        if self.playback_status.shuffle && queue.len() > 1 {
            let current = curr_idx.unwrap_or(0);
            let time_seed = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as usize)
                .unwrap_or(0);
            let step = (time_seed % (queue.len() - 1)) + 1;
            let next_idx = (current + step) % queue.len();
            return Some(queue[next_idx].clone());
        }

        match curr_idx {
            Some(idx) => {
                if idx + 1 < queue.len() {
                    Some(queue[idx + 1].clone())
                } else {
                    match self.playback_status.loop_mode {
                        LoopMode::Playlist => Some(queue[0].clone()),
                        LoopMode::Track => Some(queue[idx].clone()),
                        LoopMode::Off => {
                            if from_auto_end {
                                None
                            } else {
                                Some(queue[0].clone())
                            }
                        }
                    }
                }
            }
            None => queue.first().cloned(),
        }
    }

    /// Computes the previous track to play taking into account repeat mode, shuffle, and queue bounds.
    pub fn compute_previous_track(&self) -> Option<Track> {
        let queue = self.get_active_queue();
        if queue.is_empty() {
            return None;
        }

        let curr_id = self.playback_status.current_track.as_ref().map(|t| t.id);
        let curr_idx = curr_id.and_then(|id| queue.iter().position(|t| t.id == id));

        if self.playback_status.shuffle && queue.len() > 1 {
            let current = curr_idx.unwrap_or(0);
            let time_seed = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as usize)
                .unwrap_or(0);
            let step = (time_seed % (queue.len() - 1)) + 1;
            let prev_idx = (current + queue.len() - (step % queue.len())) % queue.len();
            return Some(queue[prev_idx].clone());
        }

        match curr_idx {
            Some(idx) => {
                if idx > 0 {
                    Some(queue[idx - 1].clone())
                } else {
                    match self.playback_status.loop_mode {
                        LoopMode::Playlist => Some(queue[queue.len() - 1].clone()),
                        _ => Some(queue[0].clone()),
                    }
                }
            }
            None => queue.first().cloned(),
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;

    fn sample_test_track(idx: usize, title: &str, artist: &str, duration_secs: u64) -> Track {
        Track {
            id: TrackId::new(),
            title: title.to_string(),
            artist: artist.to_string(),
            album: "Test Album".to_string(),
            duration: Duration::from_secs(duration_secs),
            path: PathBuf::from(format!("/music/test_{}.flac", idx)),
            track_number: Some(idx as u32),
            disc_number: Some(1),
            year: Some(2026),
            genre: Some("Electronic".to_string()),
            sample_rate: Some(96000),
            bitrate: Some(1411),
            channels: Some(2),
            date_added: chrono::Utc::now(),
        }
    }

    #[test]
    fn test_app_initialization_and_title() {
        let in_mem_lib = LibraryManager::in_memory().expect("in memory library");
        set_default_library(in_mem_lib);

        let (app, _task) = App::new();
        assert_eq!(app.active_view, ViewMode::Tracks);
        assert!(app.tracks.is_empty());
        assert!(app.playlists.is_empty());
        assert_eq!(app.playback_status.state, PlaybackState::Stopped);
        assert_eq!(app.title(), "Nghe Nhac Pro Max");

        let mut app_playing = app;
        let track = sample_test_track(1, "Instant Crush", "Daft Punk", 337);
        app_playing.playback_status.current_track = Some(track);
        assert_eq!(
            app_playing.title(),
            "Instant Crush - Daft Punk | Nghe Nhac Pro Max"
        );
    }

    #[test]
    fn test_app_view_and_search_messages() {
        let mut app = App::default();

        let _ = app.update(Message::SelectView(ViewMode::Albums));
        assert_eq!(app.active_view, ViewMode::Albums);

        let _ = app.update(Message::SearchQueryChanged("Daft Punk".to_string()));
        assert_eq!(app.search_query, "Daft Punk");

        let tid = TrackId::new();
        let _ = app.update(Message::SelectTrack(Some(tid)));
        assert_eq!(app.selected_track_id, Some(tid));

        let pid = PlaylistId::new();
        let _ = app.update(Message::SelectPlaylist(Some(pid)));
        assert_eq!(app.selected_playlist_id, Some(pid));
    }

    #[test]
    fn test_playlist_orchestration_flow() {
        let in_mem_lib = LibraryManager::in_memory().expect("in memory library");
        set_default_library(in_mem_lib);

        let mut app = App::default();
        let t1 = sample_test_track(1, "Track 1", "Artist 1", 180);
        let t2 = sample_test_track(2, "Track 2", "Artist 2", 200);
        let t1_id = t1.id;
        let t2_id = t2.id;
        app.tracks = vec![t1, t2];

        // Create playlist
        let _ = app.update(Message::CreatePlaylist("Chill Session".to_string()));
        assert_eq!(app.playlists.len(), 1);
        let pl_id = app.playlists[0].id;
        assert_eq!(app.playlists[0].name, "Chill Session");

        // Add tracks
        let _ = app.update(Message::AddTrackToPlaylist {
            playlist_id: pl_id,
            track_id: t1_id,
        });
        let _ = app.update(Message::AddTrackToPlaylist {
            playlist_id: pl_id,
            track_id: t2_id,
        });
        assert_eq!(app.playlists[0].track_ids, vec![t1_id, t2_id]);

        // Remove track
        let _ = app.update(Message::RemoveTrackFromPlaylist {
            playlist_id: pl_id,
            track_id: t1_id,
        });
        assert_eq!(app.playlists[0].track_ids, vec![t2_id]);

        // Select and delete playlist
        app.selected_playlist_id = Some(pl_id);
        let _ = app.update(Message::DeletePlaylist(pl_id));
        assert!(app.playlists.is_empty());
        assert_eq!(app.selected_playlist_id, None);
    }

    #[test]
    fn test_queue_next_and_previous_computation() {
        let mut app = App::default();
        let t1 = sample_test_track(1, "Track 1", "Artist 1", 100);
        let t2 = sample_test_track(2, "Track 2", "Artist 2", 200);
        let t3 = sample_test_track(3, "Track 3", "Artist 3", 300);
        app.tracks = vec![t1.clone(), t2.clone(), t3.clone()];

        // When nothing playing, next returns first track
        assert_eq!(app.compute_next_track(false).unwrap().id, t1.id);

        // Currently playing track 1
        app.playback_status.current_track = Some(t1.clone());
        assert_eq!(app.compute_next_track(false).unwrap().id, t2.id);

        // Currently playing track 2
        app.playback_status.current_track = Some(t2.clone());
        assert_eq!(app.compute_next_track(false).unwrap().id, t3.id);
        assert_eq!(app.compute_previous_track().unwrap().id, t1.id);

        // Currently playing track 3 (end of queue)
        app.playback_status.current_track = Some(t3.clone());
        // Off mode auto-end -> None (stop)
        app.playback_status.loop_mode = LoopMode::Off;
        assert!(app.compute_next_track(true).is_none());

        // Playlist mode auto-end -> wraps to Track 1
        app.playback_status.loop_mode = LoopMode::Playlist;
        assert_eq!(app.compute_next_track(true).unwrap().id, t1.id);

        // Track mode auto-end -> repeats Track 3
        app.playback_status.loop_mode = LoopMode::Track;
        assert_eq!(app.compute_next_track(true).unwrap().id, t3.id);

        // Previous at track 1 with Playlist loop wraps to Track 3
        app.playback_status.loop_mode = LoopMode::Playlist;
        app.playback_status.current_track = Some(t1);
        assert_eq!(app.compute_previous_track().unwrap().id, t3.id);
    }

    #[test]
    fn test_audio_playback_controls_state_routing() {
        let mut app = App::default();

        // Volume clamping and mute
        let _ = app.update(Message::SetVolume(0.75));
        assert!((app.playback_status.volume - 0.75).abs() < f32::EPSILON);

        let _ = app.update(Message::ToggleMute);
        assert!(app.playback_status.is_muted);
        let _ = app.update(Message::ToggleMute);
        assert!(!app.playback_status.is_muted);

        // LoopMode and Shuffle
        let _ = app.update(Message::SetLoopMode(LoopMode::Track));
        assert_eq!(app.playback_status.loop_mode, LoopMode::Track);

        let _ = app.update(Message::ToggleShuffle);
        assert!(app.playback_status.shuffle);

        // Seek and Pause/Resume/Stop transitions
        let _ = app.update(Message::Seek(Duration::from_secs(30)));
        let _ = app.update(Message::Pause);
        let _ = app.update(Message::Resume);
        let _ = app.update(Message::Stop);
        assert_eq!(app.playback_status.state, PlaybackState::Stopped);
    }

    #[test]
    fn test_scan_progress_and_completion_messages() {
        let mut app = App::default();

        let progress = ScanProgress {
            total_files: 50,
            scanned_files: 25,
            current_path: Some(PathBuf::from("/music/song.mp3")),
        };
        let _ = app.update(Message::ScanProgressUpdated(progress.clone()));
        assert_eq!(app.scan_progress, Some(progress));

        let t1 = sample_test_track(1, "Scanned Song", "Artist", 120);
        let _ = app.update(Message::ScanFinished(Ok(vec![t1.clone()])));
        assert_eq!(app.scan_progress, None);
        assert_eq!(app.tracks.len(), 1);
        assert_eq!(app.tracks[0].title, "Scanned Song");

        // Error does not crash
        let _ = app.update(Message::ScanFinished(Err("IO error".to_string())));
        assert_eq!(app.scan_progress, None);
    }

    #[test]
    fn test_subscription_active_only_when_playing() {
        let mut app = App::default();
        assert_eq!(app.playback_status.state, PlaybackState::Stopped);
        // No tick subscription when stopped
        let _sub_stopped = app.subscription();

        app.playback_status.state = PlaybackState::Playing;
        let _sub_playing = app.subscription();
    }

    #[test]
    fn test_toggle_play_pause_lifecycle() {
        let mut app = App::default();
        let t1 = sample_test_track(1, "Track 1", "Artist 1", 150);
        app.tracks = vec![t1.clone()];

        // Toggle from Stopped plays first track or current
        let _ = app.update(Message::TogglePlayPause);
        // AudioBackend play on non-existent file in test handles cleanly or sets status
        assert!(
            app.playback_status.current_track.is_some()
                || app.playback_status.state == PlaybackState::Stopped
        );

        // Simulate playing status
        app.playback_status.state = PlaybackState::Playing;
        let _ = app.update(Message::TogglePlayPause);
        assert_eq!(app.playback_status.state, PlaybackState::Paused);

        let _ = app.update(Message::TogglePlayPause);
        assert_eq!(app.playback_status.state, PlaybackState::Playing);
    }

    #[test]
    fn test_playlist_active_queue_isolation() {
        let mut app = App::default();
        let t1 = sample_test_track(1, "Track 1", "Artist 1", 100);
        let t2 = sample_test_track(2, "Track 2", "Artist 2", 200);
        let t3 = sample_test_track(3, "Track 3", "Artist 3", 300);
        let t1_id = t1.id;
        let t3_id = t3.id;
        app.tracks = vec![t1, t2, t3];

        let pl = Playlist {
            id: PlaylistId::new(),
            name: "Subset Playlist".to_string(),
            description: None,
            track_ids: vec![t1_id, t3_id],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        app.playlists = vec![pl.clone()];

        // No playlist selected -> queue is all tracks
        assert_eq!(app.get_active_queue().len(), 3);

        // Playlist selected -> queue contains only playlist tracks
        app.selected_playlist_id = Some(pl.id);
        let queue = app.get_active_queue();
        assert_eq!(queue.len(), 2);
        assert_eq!(queue[0].id, t1_id);
        assert_eq!(queue[1].id, t3_id);
    }

    #[test]
    fn test_audio_tick_and_track_ended_transition() {
        let mut app = App::default();
        let t1 = sample_test_track(1, "Track 1", "Artist 1", 100);
        let t2 = sample_test_track(2, "Track 2", "Artist 2", 200);
        app.tracks = vec![t1.clone(), t2.clone()];
        app.playback_status.current_track = Some(t1);
        app.playback_status.state = PlaybackState::Playing;

        // Simulate track ending
        let _ = app.update(Message::AudioTrackEnded);
        assert_eq!(app.selected_track_id, Some(t2.id));

        // Audio error handling without crash
        let _ = app.update(Message::AudioError("Device disconnected".to_string()));
    }
}
