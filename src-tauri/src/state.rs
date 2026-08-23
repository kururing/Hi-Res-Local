use std::sync::{Arc, Mutex};

use crate::db::Database;
use crate::scanner::watcher::LibraryWatcher;

pub struct AppState {
    pub db: Arc<Database>,
    pub watcher: Arc<Mutex<Option<LibraryWatcher>>>,
}

impl AppState {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            watcher: Arc::new(Mutex::new(None)),
        }
    }
}
