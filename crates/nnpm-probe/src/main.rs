use std::env;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process;

use nnpm_audio_core::probe_path;

fn main() {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("-v") | Some("--version") => {
            println!("nnpm-probe 0.1.0");
            return;
        }
        Some("-h") | Some("--help") => {
            eprintln!("usage: nnpm-probe [--json] <file>");
            return;
        }
        Some("--json") => {
            let Some(path) = args.next() else {
                fail("missing file path");
            };
            emit(&PathBuf::from(path));
        }
        Some(path) => emit(&PathBuf::from(path)),
        None => fail("usage: nnpm-probe [--json] <file>"),
    }
}

fn emit(path: &PathBuf) {
    match probe_path(path) {
        Ok(mut report) => {
            // Worker parses metadata only; embedded pictures go through extractEmbeddedArtwork.
            // Base64 covers routinely exceed the 1 MiB probe stdout cap and stall ingestion.
            report.artwork_base64 = None;
            let json = serde_json::to_string(&report).expect("serialize probe report");
            let mut out = io::stdout().lock();
            let _ = writeln!(out, "{json}");
        }
        Err(error) => fail(&error.to_string()),
    }
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    process::exit(1);
}
