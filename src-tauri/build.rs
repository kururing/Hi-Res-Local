use std::env;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    #[cfg(windows)]
    {
        setup_asio_windows();
    }
}

#[cfg(windows)]
fn setup_asio_windows() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let sdk = manifest_dir.join("vendor").join("asio-sdk").join("ASIOSDK");
    let common = sdk.join("common");
    let host = sdk.join("host");
    let pc = host.join("pc");

    if !common.join("asio.h").is_file() || !pc.join("asiolist.cpp").is_file() {
        panic!(
            "Vendored Steinberg ASIO SDK not found at {}. Native DSD requires the GPLv3 SDK sources.",
            sdk.display()
        );
    }

    println!("cargo:rerun-if-changed=src/audio/asio_bridge.cpp");
    println!("cargo:rerun-if-changed=src/audio/asio_bridge.h");
    println!("cargo:rerun-if-changed=vendor/asio-sdk/ASIOSDK/common/asio.cpp");
    println!("cargo:rerun-if-changed=vendor/asio-sdk/ASIOSDK/common/asio.h");
    println!("cargo:rerun-if-changed=vendor/asio-sdk/ASIOSDK/host/asiodrivers.cpp");
    println!("cargo:rerun-if-changed=vendor/asio-sdk/ASIOSDK/host/asiodrivers.h");
    println!("cargo:rerun-if-changed=vendor/asio-sdk/ASIOSDK/host/pc/asiolist.cpp");
    println!("cargo:rerun-if-changed=vendor/asio-sdk/ASIOSDK/host/pc/asiolist.h");
    println!("cargo:rerun-if-changed=vendor/asio-sdk/ASIOSDK/LICENSE.txt");

    cc::Build::new()
        .cpp(true)
        .file(common.join("asio.cpp"))
        .file(host.join("asiodrivers.cpp"))
        .file(pc.join("asiolist.cpp"))
        .file(
            manifest_dir
                .join("src")
                .join("audio")
                .join("asio_bridge.cpp"),
        )
        .include(&common)
        .include(&host)
        .include(&pc)
        .define("WIN32_LEAN_AND_MEAN", None)
        .define("NOMINMAX", None)
        .flag("/FIwindows.h")
        .flag("/FIobjbase.h")
        .flag_if_supported("/EHsc")
        .compile("nghenhacpromax_asio");

    println!("cargo:rustc-link-lib=ole32");
}
