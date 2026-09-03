//! RFC 8251 / 6716 Opus vector gate.
//! Place official vectors in `tests/corpus/opus/` (gitignored large files).
//! Identification and full decode are mandatory once official vectors are vendored.

use nnpm_audio_core::opus::{identify_ogg_opus, rfc_vectors_available};

#[test]
fn opus_rfc_gate() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/opus");
    if !rfc_vectors_available(&dir) {
        eprintln!(
            "SKIPPED: official Opus RFC corpus is not vendored at {}",
            dir.display()
        );
        assert!(identify_ogg_opus(b"not ogg").is_err());
        return;
    }
    let mut decoded_any = false;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("opus") {
            continue;
        }
        let bytes = std::fs::read(&path).unwrap();
        identify_ogg_opus(&bytes).unwrap_or_else(|_| panic!("identify {}", path.display()));
        let source = nnpm_audio_core::source::MediaSource::from_bytes("rfc.opus", bytes);
        match nnpm_audio_core::decoder::PcmDecoder::open(source) {
            Ok(mut decoder) => {
                let pcm = decoder.decode_all_f32().expect("decode opus vector");
                assert!(!pcm.is_empty(), "empty decode for {}", path.display());
                decoded_any = true;
            }
            Err(error) => panic!(
                "Opus RFC vector {} failed to decode with the registered Rust Opus decoder: {error}",
                path.display()
            ),
        }
    }
    assert!(
        decoded_any,
        "opus corpus present but no .opus files decoded"
    );
}
