use directories::ProjectDirs;
use lofty::file::{TaggedFile, TaggedFileExt};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub const FOLDER_COVER_NAMES: &[&str] = &[
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "cover.webp",
    "folder.jpg",
    "folder.jpeg",
    "folder.png",
    "front.jpg",
    "front.jpeg",
    "front.png",
    "albumart.jpg",
    "albumart.jpeg",
    "albumart.png",
    "artwork.jpg",
    "artwork.png",
];

pub fn get_cover_cache_dir() -> AppResult<PathBuf> {
    let proj = ProjectDirs::from("com", "nghenhacpromax", "app")
        .ok_or_else(|| AppError::Path("Failed to get cache dir".to_string()))?;
    let dir = proj.cache_dir().join("covers");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn extract_and_cache_cover(
    tagged_file: Option<&TaggedFile>,
    audio_path: &Path,
) -> Option<String> {
    // 1. Try extracting embedded picture from lofty tags
    if let Some(tf) = tagged_file {
        if let Some(tag) = tf.primary_tag().or_else(|| tf.first_tag()) {
            let pictures = tag.pictures();
            if let Some(pic) = pictures.first() {
                let data = pic.data();
                if !data.is_empty() {
                    let mut hasher = Sha256::new();
                    hasher.update(data);
                    let hash_str = format!("{:x}", hasher.finalize());

                    let ext = match pic.mime_type() {
                        Some(lofty::picture::MimeType::Jpeg) => "jpg",
                        Some(lofty::picture::MimeType::Png) => "png",
                        _ => "jpg",
                    };

                    if let Ok(cache_dir) = get_cover_cache_dir() {
                        let target_path = cache_dir.join(format!("{}.{}", hash_str, ext));
                        if target_path.exists() {
                            return Some(target_path.to_string_lossy().to_string());
                        }

                        if fs::write(&target_path, data).is_ok() {
                            return Some(target_path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback: Search parent directory for folder art
    if let Some(parent) = audio_path.parent() {
        for candidate_name in FOLDER_COVER_NAMES {
            let candidate_path = parent.join(candidate_name);
            if candidate_path.is_file() {
                return Some(candidate_path.to_string_lossy().to_string());
            }
        }
    }

    None
}
