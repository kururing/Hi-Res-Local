use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();

    #[cfg(windows)]
    {
        setup_ffmpeg_windows();
    }
}

#[cfg(windows)]
fn setup_ffmpeg_windows() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let vendor = manifest_dir.join("vendor").join("ffmpeg");

    if !vendor.join("include").is_dir() || !vendor.join("lib").is_dir() {
        panic!(
            "Vendored FFmpeg not found at {}. Run scripts/fetch-ffmpeg-windows.ps1 first.",
            vendor.display()
        );
    }

    println!("cargo:rerun-if-changed=vendor/ffmpeg/include");
    println!("cargo:rerun-if-changed=vendor/ffmpeg/lib");
    println!("cargo:rerun-if-changed=vendor/ffmpeg/bin");

    // ffmpeg-next / ffmpeg-sys-next discover headers + import libs via FFMPEG_DIR.
    println!("cargo:rustc-env=FFMPEG_DIR={}", vendor.display());
    // Also export for the build script of ffmpeg-sys-next (inherits env from parent).
    println!("cargo:FFMPEG_DIR={}", vendor.display());
    env::set_var("FFMPEG_DIR", &vendor);

    let bin_dir = vendor.join("bin");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    // OUT_DIR is target/<profile>/build/<crate>/out — copy DLLs next to the final binary.
    // profile_dir ≈ target/debug or target/release
    let profile_dir = out_dir
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| manifest_dir.join("target").join("debug"));

    if let Ok(entries) = fs::read_dir(&bin_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("dll") {
                let dest = profile_dir.join(entry.file_name());
                let _ = fs::copy(&path, &dest);
                // Also copy beside the library build products used by `cargo test`.
                let deps = profile_dir.join("deps");
                if deps.is_dir() {
                    let _ = fs::copy(&path, deps.join(entry.file_name()));
                }
            }
        }
    }

    println!(
        "cargo:rustc-link-search=native={}",
        vendor.join("lib").display()
    );
}
