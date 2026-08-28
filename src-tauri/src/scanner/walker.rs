use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "aac", "alac", "m4a", "aiff", "aif", "opus", "wma", "ape", "mpc",
    "oga", "mka", "dsf", "dff",
];

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            SUPPORTED_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

pub fn scan_directory_for_audio_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if !root.exists() {
        return files;
    }

    if root.is_file() {
        if is_audio_file(root) {
            files.push(root.to_path_buf());
        }
        return files;
    }

    for entry in WalkDir::new(root)
        // Library roots are explicit trust boundaries. Following a junction or
        // symlink could escape the folder the user selected or create cycles.
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && is_audio_file(path) {
            files.push(path.to_path_buf());
        }
    }

    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_dsd_containers_case_insensitively_but_not_standalone_dst() {
        assert!(is_audio_file(Path::new("album/song.DSF")));
        assert!(is_audio_file(Path::new("album/song.Dff")));
        assert!(!is_audio_file(Path::new("album/song.DST")));
        assert!(!is_audio_file(Path::new("album/song")));
    }

    #[test]
    fn directory_scan_includes_dsf_and_dff() {
        let directory = tempfile::tempdir().unwrap();
        let dsf = directory.path().join("one.DSF");
        let dff = directory.path().join("two.dff");
        let dst = directory.path().join("three.dst");
        std::fs::write(&dsf, []).unwrap();
        std::fs::write(&dff, []).unwrap();
        std::fs::write(&dst, []).unwrap();

        let mut found = scan_directory_for_audio_files(directory.path());
        found.sort();
        assert_eq!(found, vec![dsf, dff]);
    }
}
