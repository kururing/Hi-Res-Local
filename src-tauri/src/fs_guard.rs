use rusqlite::Connection;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::db::queries_library::get_library_roots;

pub fn normalize_path(path: &Path) -> PathBuf {
    strip_verbatim(resolve_existing_prefix(path))
}

fn resolve_existing_prefix(path: &Path) -> PathBuf {
    let mut current = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    let mut suffix = Vec::new();
    loop {
        if let Ok(canonical) = std::fs::canonicalize(&current) {
            let mut resolved = canonical;
            for part in suffix.iter().rev() {
                resolved.push(part);
            }
            return resolved;
        }
        match current.file_name().map(|name| name.to_os_string()) {
            Some(name) => {
                suffix.push(name);
                if !current.pop() {
                    break;
                }
            }
            None => break,
        }
    }
    for part in suffix.into_iter().rev() {
        current.push(part);
    }
    current
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

pub fn is_within(child: &Path, parent: &Path) -> bool {
    let child = normalize_path(child);
    let parent = normalize_path(parent);
    path_starts_with(&child, &parent)
}

fn path_starts_with(child: &Path, parent: &Path) -> bool {
    if parent.as_os_str().is_empty() {
        return false;
    }
    if child.starts_with(parent) {
        return true;
    }
    // Path::starts_with is case-sensitive; Windows directories are not.
    #[cfg(windows)]
    {
        let parent_comps: Vec<_> = parent.components().collect();
        let child_comps: Vec<_> = child.components().collect();
        !parent_comps.is_empty()
            && parent_comps.len() <= child_comps.len()
            && parent_comps
                .iter()
                .zip(child_comps.iter())
                .all(|(parent_comp, child_comp)| {
                    parent_comp
                        .as_os_str()
                        .eq_ignore_ascii_case(child_comp.as_os_str())
                })
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn remember_path(store: &Mutex<HashSet<PathBuf>>, path: &Path) {
    let mut set = store.lock().unwrap_or_else(|error| error.into_inner());
    set.insert(normalize_path(path));
}

pub fn is_remembered(store: &Mutex<HashSet<PathBuf>>, path: &Path) -> bool {
    let set = store.lock().unwrap_or_else(|error| error.into_inner());
    set.contains(&normalize_path(path))
}

pub fn assert_new_library_root(
    path: &str,
    allowed: &Mutex<HashSet<PathBuf>>,
) -> Result<(), String> {
    let path = Path::new(path);
    if !path.is_dir() {
        return Err("Library root must be an existing directory".into());
    }
    if is_remembered(allowed, path) {
        return Ok(());
    }
    Err("Library root must be chosen from the folder dialog".into())
}

pub fn assert_scan_path(
    conn: &Connection,
    allowed: &Mutex<HashSet<PathBuf>>,
    path: &str,
) -> Result<(), String> {
    let path = Path::new(path.trim());
    if is_remembered(allowed, path) {
        return Ok(());
    }
    for root in get_library_roots(conn).map_err(|error| error.to_string())? {
        if is_within(path, Path::new(&root.path)) {
            return Ok(());
        }
    }
    Err("Scan path is outside the music library".into())
}

pub fn assert_media_path(
    conn: &Connection,
    allowed: &Mutex<HashSet<PathBuf>>,
    path: &str,
) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Track path is missing".into());
    }
    let path = Path::new(trimmed);
    if is_remembered(allowed, path) {
        return Ok(());
    }
    for root in get_library_roots(conn).map_err(|error| error.to_string())? {
        if is_within(path, Path::new(&root.path)) {
            return Ok(());
        }
    }
    Err("Path is outside the music library".into())
}

pub fn assert_export_path(app: &tauri::AppHandle, dest: &str) -> Result<(), String> {
    use tauri::Manager;
    let dest = Path::new(dest);
    let parent = dest.parent().filter(|path| !path.as_os_str().is_empty());
    let dest_norm = if dest.exists() {
        normalize_path(dest)
    } else if let Some(parent) = parent.filter(|path| path.exists()) {
        normalize_path(parent).join(dest.file_name().unwrap_or_default())
    } else {
        return Err("Backup path is not allowed".into());
    };
    let mut bases = Vec::new();
    if let Ok(dir) = app.path().app_data_dir() {
        bases.push(normalize_path(&dir));
    }
    if let Ok(dir) = app.path().download_dir() {
        bases.push(normalize_path(&dir));
    }
    if let Ok(dir) = app.path().document_dir() {
        bases.push(normalize_path(&dir));
    }
    if bases.iter().any(|base| path_starts_with(&dest_norm, base)) {
        return Ok(());
    }
    Err("Backup path must be inside app data, Downloads, or Documents".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_paths_are_inside_the_parent() {
        let parent = std::env::temp_dir().join("nnpm-fs-guard-parent");
        let child = parent.join("album").join("track.flac");
        let _ = std::fs::create_dir_all(child.parent().unwrap());
        assert!(is_within(&child, &parent));
        assert!(!is_within(&parent, &child));
    }

    #[test]
    fn empty_prefixes_are_not_remembered_as_media_roots() {
        let allowed = Mutex::new(HashSet::new());
        remember_path(&allowed, Path::new("."));
        assert!(is_remembered(&allowed, Path::new(".")));
    }

    #[test]
    fn remembered_paths_are_exact_matches_not_parent_roots() {
        let allowed = Mutex::new(HashSet::new());
        let file = std::env::temp_dir().join("nnpm-fs-guard-file.flac");
        remember_path(&allowed, &file);
        assert!(is_remembered(&allowed, &file));
        assert!(!is_remembered(&allowed, file.parent().unwrap()));
    }
}
