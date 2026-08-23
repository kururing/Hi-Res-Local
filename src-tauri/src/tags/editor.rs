use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag, TagExt};
use std::path::Path;

use crate::db::queries_tracks::{get_track_by_id, update_track_tags};
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::track::{Track, TrackUpdateTags};

pub fn write_tags_to_file(audio_path: &Path, update: &TrackUpdateTags) -> AppResult<()> {
    let mut tagged_file = Probe::open(audio_path)?.read()?;

    let tag = match tagged_file.primary_tag_mut() {
        Some(primary) => primary,
        None => {
            if let Some(first) = tagged_file.first_tag_mut() {
                first
            } else {
                let tag_type = tagged_file.primary_tag_type();
                tagged_file.insert_tag(Tag::new(tag_type));
                tagged_file.primary_tag_mut().unwrap()
            }
        }
    };

    if let Some(ref title) = update.title {
        tag.set_title(title.clone());
    }
    if let Some(ref artist) = update.artist {
        tag.set_artist(artist.clone());
    }
    if let Some(ref album_artist) = update.album_artist {
        tag.insert_text(ItemKey::AlbumArtist, album_artist.clone());
    }
    if let Some(ref album) = update.album {
        tag.set_album(album.clone());
    }
    if let Some(ref genre) = update.genre {
        tag.set_genre(genre.clone());
    }
    if let Some(year) = update.year {
        tag.set_year(year);
    }
    if let Some(track_no) = update.track_number {
        tag.set_track(track_no);
    }
    if let Some(disc_no) = update.disc_number {
        tag.set_disk(disc_no);
    }
    if let Some(ref lyrics) = update.lyrics {
        tag.insert_text(ItemKey::Lyrics, lyrics.clone());
    }

    use lofty::config::WriteOptions;
    tag.save_to_path(audio_path, WriteOptions::default())?;
    Ok(())
}

pub fn update_tags_and_save(db: &Database, update: &TrackUpdateTags) -> AppResult<Track> {
    let track = {
        let conn = db.lock();
        get_track_by_id(&conn, &update.id)?
            .ok_or_else(|| AppError::NotFound(format!("Track not found: {}", update.id)))?
    };

    let audio_path = Path::new(&track.path);
    if audio_path.is_file() {
        if let Err(err) = write_tags_to_file(audio_path, update) {
            tracing::warn!("Failed to write lofty tags to file {}: {}", track.path, err);
        }
    }

    {
        let conn = db.lock();
        update_track_tags(&conn, update)?;
        get_track_by_id(&conn, &update.id)?
            .ok_or_else(|| AppError::Internal("Failed to retrieve updated track".to_string()))
    }
}
