use std::sync::{Arc, Mutex};

use crate::audio::adapters::{FallbackMediaControlsAdapter, StandardAudioAdapter};
use crate::audio::player::AudioPlayer;
use crate::db::Database;
use crate::scanner::watcher::LibraryWatcher;

pub struct AppState {
    pub db: Arc<Database>,
    pub watcher: Arc<Mutex<Option<LibraryWatcher>>>,
    pub player: Arc<AudioPlayer>,
    pub exclusive_adapter: Arc<Mutex<StandardAudioAdapter>>,
    pub media_controls_adapter: Arc<Mutex<FallbackMediaControlsAdapter>>,
}

impl AppState {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            watcher: Arc::new(Mutex::new(None)),
            player: Arc::new(AudioPlayer::new()),
            exclusive_adapter: Arc::new(Mutex::new(StandardAudioAdapter::new())),
            media_controls_adapter: Arc::new(Mutex::new(FallbackMediaControlsAdapter::new())),
        }
    }
}
