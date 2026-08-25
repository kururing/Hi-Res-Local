//! Smoke tests for FFmpeg decode + WASAPI exclusive negotiation (Windows).

#![cfg(windows)]

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::Duration;

use nghenhacpromax_lib::audio::decoder::AudioDecoder;
use nghenhacpromax_lib::audio::dto::AudioTrack;
use nghenhacpromax_lib::audio::pcm::AudioFormat;
use nghenhacpromax_lib::audio::pcm_ring::PcmRing;
use nghenhacpromax_lib::audio::wasapi::{
    FormatNegotiator, WasapiDeviceManager, WasapiExclusiveOutput, WasapiShareMode,
};
use nghenhacpromax_lib::audio::AudioPlayer;

fn audio_device_guard() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

fn write_minimal_wav(path: &PathBuf, sample_rate: u32, bits: u16, frames: u32) {
    let channels: u16 = 2;
    let block_align = channels * (bits / 8);
    let byte_rate = sample_rate * u32::from(block_align);
    let data_size = frames * u32::from(block_align);
    let mut f = File::create(path).expect("create wav");
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data_size).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap(); // pcm fmt chunk size
    f.write_all(&1u16.to_le_bytes()).unwrap(); // PCM
    f.write_all(&channels.to_le_bytes()).unwrap();
    f.write_all(&sample_rate.to_le_bytes()).unwrap();
    f.write_all(&byte_rate.to_le_bytes()).unwrap();
    f.write_all(&block_align.to_le_bytes()).unwrap();
    f.write_all(&bits.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&data_size.to_le_bytes()).unwrap();
    let mut pcm = Vec::with_capacity(data_size as usize);
    for frame in 0..frames {
        let phase = frame as f32 * 440.0 * std::f32::consts::TAU / sample_rate as f32;
        let sample = (phase.sin() * i16::MAX as f32 * 0.1) as i16;
        for _ in 0..channels {
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
    }
    f.write_all(&pcm).unwrap();
}

fn write_pcm24_wav(path: &PathBuf, sample_rate: u32, frames: u32) {
    let channels: u16 = 2;
    let block_align = channels * 3;
    let data_size = frames * u32::from(block_align);
    let mut f = File::create(path).expect("create 24-bit wav");
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data_size).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&channels.to_le_bytes()).unwrap();
    f.write_all(&sample_rate.to_le_bytes()).unwrap();
    f.write_all(&(sample_rate * u32::from(block_align)).to_le_bytes())
        .unwrap();
    f.write_all(&block_align.to_le_bytes()).unwrap();
    f.write_all(&24u16.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&data_size.to_le_bytes()).unwrap();
    for frame in 0..frames {
        let sample = if frame % 2 == 0 {
            0x12_3456
        } else {
            -0x12_3456
        };
        let bytes = (sample as i32).to_le_bytes();
        for _ in 0..channels {
            f.write_all(&bytes[..3]).unwrap();
        }
    }
}

#[test]
fn ffmpeg_decodes_wav_16_44100() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tone_16_44.wav");
    write_minimal_wav(&path, 44_100, 16, 44_100 / 10); // 100ms

    let mut dec = AudioDecoder::open(&path).expect("open wav");
    assert_eq!(dec.sample_rate(), 44_100);
    assert_eq!(dec.channels(), 2);
    assert_eq!(dec.source_format().bit_depth, 16);

    let mut got = false;
    for _ in 0..64 {
        match dec.decode_next_packet().expect("decode") {
            Some(samples) if !samples.is_empty() => {
                got = true;
                break;
            }
            Some(_) => continue,
            None => break,
        }
    }
    assert!(got, "expected at least one decoded PCM chunk");

    let mut raw = AudioDecoder::open(&path).expect("reopen wav for raw PCM");
    let bytes = raw
        .decode_next_bytes()
        .expect("decode raw PCM")
        .expect("expected raw PCM frame");
    assert!(!bytes.is_empty(), "raw PCM frame must not be empty");
    assert!(
        bytes.iter().any(|byte| *byte != 0),
        "raw PCM must contain the generated tone"
    );
}

#[test]
fn ffmpeg_pcm24_packs_high_valid_bits_without_static() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tone_24_96.wav");
    write_pcm24_wav(&path, 96_000, 128);

    let mut decoder = AudioDecoder::open(&path).expect("open 24-bit wav");
    assert_eq!(decoder.source_format().sample_rate, 96_000);
    assert_eq!(decoder.source_format().bit_depth, 24);
    decoder
        .configure_bit_perfect_wire(AudioFormat::s24_packed(96_000, 2), true, 3)
        .expect("configure packed 24-bit wire");
    let bytes = decoder
        .decode_next_bytes()
        .expect("decode packed 24-bit")
        .expect("PCM frame");
    assert!(!bytes.is_empty());
    assert_eq!(bytes.len() % 6, 0, "stereo packed frames must be aligned");

    for (frame_index, frame) in bytes.chunks_exact(6).enumerate() {
        let value: i32 = if frame_index % 2 == 0 {
            0x12_3456
        } else {
            -0x12_3456
        };
        let expected = value.to_le_bytes();
        assert_eq!(&frame[..3], &expected[..3]);
        assert_eq!(&frame[3..], &expected[..3]);
    }
}

#[test]
fn wasapi_enumerates_and_negotiates_exclusive() {
    let _guard = audio_device_guard();
    let mgr = WasapiDeviceManager::new();
    let devices = mgr.enumerate_devices().expect("enumerate devices");
    assert!(
        !devices.is_empty(),
        "expected at least one Windows render endpoint"
    );
    // Endpoint id must be the stable IMMDevice::GetId string, not only a friendly name.
    // First entry is the synthetic "default" sentinel.
    assert_eq!(devices[0].id, "default");
    assert!(
        devices
            .iter()
            .skip(1)
            .any(|d| d.id.contains('{') || d.id.len() > 8),
        "expected WASAPI endpoint ids in device list"
    );

    let device = mgr.get_active_device().expect("active device");
    let endpoint = mgr
        .resolve_active_endpoint_id()
        .expect("resolve default endpoint id");
    assert!(!endpoint.is_empty());

    let src = AudioFormat::s16(44_100, 2);
    let negotiated = FormatNegotiator::negotiate(&device, &src, false)
        .expect("exclusive negotiate 16/44.1 (non-bit-perfect may convert)");
    assert_eq!(negotiated.share_mode, WasapiShareMode::Exclusive);
    assert!(negotiated.format.sample_rate >= 44_100 || !negotiated.is_native);
    assert!(
        !negotiated.wave.describe().is_empty(),
        "negotiated wave blob must be present for Initialize"
    );

    // Bit-perfect exact: may fail on some devices — that's OK, just must not panic.
    let _ = FormatNegotiator::negotiate(&device, &src, true);
}

#[test]
fn windows_endpoint_volume_read_and_idempotent_write() {
    let _guard = audio_device_guard();
    let manager = WasapiDeviceManager::new();
    let (volume, muted) = match manager.endpoint_audio_state() {
        Ok(state) => state,
        Err(_) => return,
    };
    assert!((0.0..=1.0).contains(&volume));

    // Writing the current values validates the COM path without changing the
    // user's audible volume or mute state.
    manager
        .set_endpoint_volume(volume)
        .expect("write current endpoint volume");
    manager
        .set_endpoint_muted(muted)
        .expect("write current endpoint mute");
    let (roundtrip_volume, roundtrip_muted) = manager
        .endpoint_audio_state()
        .expect("read endpoint state after idempotent write");
    assert!((roundtrip_volume - volume).abs() <= 0.01);
    assert_eq!(roundtrip_muted, muted);
}

#[test]
fn wasapi_exclusive_open_start_stop_smoke() {
    let _guard = audio_device_guard();
    let mgr = WasapiDeviceManager::new();
    let device = match mgr.get_active_device() {
        Ok(d) => d,
        Err(_) => return, // no render device in this environment
    };
    if !FormatNegotiator::exclusive_supported(&device) {
        return; // driver disallows Exclusive — skip without failing CI
    }

    let src = AudioFormat::s16(48_000, 2);
    let negotiated = match FormatNegotiator::negotiate(&device, &src, false) {
        Ok(n) => n,
        Err(_) => return,
    };

    let ring = PcmRing::for_format_default(&negotiated.format);
    let (_producer, consumer) = ring.split();
    let mut output = match WasapiExclusiveOutput::open(&device, negotiated) {
        Ok(o) => o,
        Err(_) => return,
    };
    let pending_reset = Arc::new(AtomicBool::new(false));
    match output.start(consumer, pending_reset, None) {
        Ok(()) => {
            assert!(
                output.is_running(),
                "exclusive Start handshake must leave stream running"
            );
            thread::sleep(Duration::from_millis(80));
            output.stop().expect("stop exclusive");
            assert!(!output.is_running());
        }
        Err(err) => {
            // Device in use / exclusive not allowed is an acceptable soft skip.
            let msg = err.to_string().to_lowercase();
            assert!(
                msg.contains("exclusive")
                    || msg.contains("in use")
                    || msg.contains("not allowed")
                    || msg.contains("initialize"),
                "unexpected exclusive start error: {err}"
            );
        }
    }
}

#[test]
fn player_select_output_device_default_roundtrip() {
    let _guard = audio_device_guard();
    let player = AudioPlayer::new();
    player
        .select_output_device(Some("default".into()))
        .expect("selecting system default must succeed");
    // Unknown endpoint must fail loudly (no silent Shared fallback).
    let err = player.select_output_device(Some(
        "{0.0.0.00000000}.{00000000-0000-0000-0000-000000000000}".into(),
    ));
    assert!(
        err.is_err(),
        "missing endpoint must not report success while staying on default"
    );
}

#[test]
fn player_exclusive_toggle_roundtrip_or_clear_fail() {
    let _guard = audio_device_guard();
    let player = AudioPlayer::new();
    assert!(!player.exclusive_mode());
    match player.set_exclusive_mode(true) {
        Ok(()) => {
            assert!(player.exclusive_mode());
            assert!(
                !player.both_outputs_active_for_test(),
                "Shared must be stopped while Exclusive runs"
            );
            player
                .set_exclusive_mode(false)
                .expect("disable exclusive restores Shared");
            assert!(!player.exclusive_mode());
        }
        Err(_) => {
            assert!(
                !player.exclusive_mode(),
                "failed exclusive enable must not leave the flag on"
            );
        }
    }
}

#[test]
fn player_keeps_advancing_after_enabling_bit_perfect() {
    let _guard = audio_device_guard();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tone_16_44.wav");
    write_minimal_wav(&path, 44_100, 16, 44_100 * 2);

    let player = AudioPlayer::new();
    player
        .play_track(AudioTrack {
            id: "bit-perfect-smoke".into(),
            path: path.to_string_lossy().into_owned(),
            title: "Bit-perfect smoke".into(),
            artist: "Test".into(),
            album: "Test".into(),
            duration_ms: 2_000,
            track_number: None,
            year: None,
            genre: None,
            replay_gain: None,
        })
        .expect("start shared playback");

    thread::sleep(Duration::from_millis(120));
    player
        .set_exclusive_mode(true)
        .expect("enable WASAPI Exclusive while playing");
    player
        .set_bit_perfect(true)
        .expect("enable Bit-Perfect while playing");
    thread::sleep(Duration::from_millis(500));

    let snapshot = player.get_snapshot();
    assert!(snapshot.bit_perfect, "Bit-Perfect flag must remain enabled");
    assert!(
        snapshot.progress.position_ms >= 150,
        "playback stalled after enabling Bit-Perfect: {} ms",
        snapshot.progress.position_ms
    );
}
