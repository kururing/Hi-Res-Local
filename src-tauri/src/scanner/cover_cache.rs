use directories::ProjectDirs;
use lofty::file::{TaggedFile, TaggedFileExt};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::error::{AppError, AppResult};

/// Covers are resized to fit within this dimension before caching. Full-size
/// embedded art (often 1000–3000px) is never stored or served to the UI.
const MAX_COVER_DIM: u32 = 512;

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

fn folder_art_cache_key(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(meta.len().to_le_bytes());
    hasher.update(modified.to_le_bytes());
    Some(format!("{:x}", hasher.finalize()))
}

/// Write cover bytes to `target_path`, downscaled to [`MAX_COVER_DIM`] when
/// larger. Uses a temp file + rename so concurrent scan threads producing the
/// same hash never interleave writes. Falls back to the original bytes when the
/// image cannot be decoded or re-encoded.
fn write_cover_resized(data: &[u8], target_path: &Path) -> bool {
    let tmp_path = target_path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));

    let written = match image::load_from_memory(data) {
        Ok(img) if img.width() > MAX_COVER_DIM || img.height() > MAX_COVER_DIM => {
            let thumb = img.thumbnail(MAX_COVER_DIM, MAX_COVER_DIM);
            let format = target_path
                .extension()
                .and_then(|ext| ext.to_str())
                .and_then(image::ImageFormat::from_extension)
                .unwrap_or(image::ImageFormat::Jpeg);
            thumb.save_with_format(&tmp_path, format).is_ok() || fs::write(&tmp_path, data).is_ok()
        }
        _ => fs::write(&tmp_path, data).is_ok(),
    };

    if !written {
        let _ = fs::remove_file(&tmp_path);
        return false;
    }

    if fs::rename(&tmp_path, target_path).is_ok() {
        return true;
    }
    // Rename can fail on Windows when another thread won the race; the target
    // then already holds identical content.
    let _ = fs::remove_file(&tmp_path);
    target_path.exists()
}

pub fn extract_and_cache_cover(
    tagged_file: Option<&TaggedFile>,
    audio_path: &Path,
) -> Option<String> {
    // 1. Embedded picture is already in the tagged file — write and drop, no extra full-file read.
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

                        if write_cover_resized(data, &target_path) {
                            return Some(target_path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    // 2. Folder art: cache by path+size+mtime, resized to a thumbnail.
    if let Some(parent) = audio_path.parent() {
        for candidate_name in FOLDER_COVER_NAMES {
            let candidate_path = parent.join(candidate_name);
            if !candidate_path.is_file() {
                continue;
            }
            let Some(hash_str) = folder_art_cache_key(&candidate_path) else {
                continue;
            };
            let ext = candidate_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("jpg");

            if let Ok(cache_dir) = get_cover_cache_dir() {
                let target_path = cache_dir.join(format!("{}.{}", hash_str, ext));
                if target_path.exists() {
                    return Some(target_path.to_string_lossy().to_string());
                }
                let cached = match fs::read(&candidate_path) {
                    Ok(data) => write_cover_resized(&data, &target_path),
                    Err(_) => fs::copy(&candidate_path, &target_path).is_ok(),
                };
                if cached {
                    return Some(target_path.to_string_lossy().to_string());
                }
            }
        }
    }

    None
}

/// Cache an image extracted from a container-specific metadata block (for
/// example ID3/APIC inside DSF or DSDIFF), then use the normal folder-art
/// fallback when the embedded payload is absent or invalid.
pub fn extract_and_cache_cover_bytes(data: Option<&[u8]>, audio_path: &Path) -> Option<String> {
    if let Some(data) = data.filter(|bytes| !bytes.is_empty()) {
        let mut hasher = Sha256::new();
        hasher.update(data);
        let hash = format!("{:x}", hasher.finalize());
        let ext = image::guess_format(data)
            .ok()
            .and_then(|format| match format {
                image::ImageFormat::Jpeg => Some("jpg"),
                image::ImageFormat::Png => Some("png"),
                image::ImageFormat::WebP => Some("webp"),
                _ => None,
            })
            .unwrap_or("jpg");
        if let Ok(cache_dir) = get_cover_cache_dir() {
            let target = cache_dir.join(format!("{hash}.{ext}"));
            if target.exists() || write_cover_resized(data, &target) {
                return Some(target.to_string_lossy().to_string());
            }
        }
    }
    extract_and_cache_cover(None, audio_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn resized_png_keeps_a_decodable_png_format() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("cover.png");
        let image = image::DynamicImage::new_rgb8(1024, 768);
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();

        assert!(write_cover_resized(encoded.get_ref(), &target));
        let cached = image::open(&target).unwrap();
        assert!(cached.width() <= MAX_COVER_DIM);
        assert!(cached.height() <= MAX_COVER_DIM);
        assert_eq!(
            image::ImageFormat::from_path(&target).unwrap(),
            image::ImageFormat::Png
        );
    }
}
