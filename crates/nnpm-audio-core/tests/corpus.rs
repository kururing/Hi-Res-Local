use nnpm_audio_core::decoder::PcmDecoder;
use nnpm_audio_core::engine::compare_pcm;
use nnpm_audio_core::probe::AudioProbe;
use nnpm_audio_core::source::MediaSource;
use nnpm_audio_core::wav::{sine_s16, write_wav_s16};

#[test]
fn wav_roundtrip_matches_samples() {
    let rate = 44_100u32;
    let samples = sine_s16(256, 2, 440.0, rate);
    let wav = write_wav_s16(rate, 2, &samples);
    let source = MediaSource::from_bytes("sine.wav", wav.clone());
    let mut decoder = PcmDecoder::open(source).expect("open wav");
    let decoded = decoder.decode_all_f32().expect("decode");
    assert_eq!(decoded.len(), samples.len());
    let reference: Vec<f32> = samples.iter().map(|s| *s as f32 / 32768.0).collect();
    compare_pcm(&reference, &decoded, 2.0 / 32768.0).expect("pcm lossless");
}

#[test]
fn probe_wav_reports_pcm() {
    let wav = write_wav_s16(48_000, 2, &sine_s16(48, 2, 1000.0, 48_000));
    let mut source = MediaSource::from_bytes("probe.wav", wav);
    let report = AudioProbe::inspect(&mut source).expect("probe");
    assert_eq!(report.codec, "pcm");
    assert_eq!(report.container, "wav");
    assert_eq!(report.sample_rate_hz, 48_000);
    assert_eq!(report.channels, 2);
    assert!(report.duration_seconds > 0.0);
}

#[test]
fn wav_s16_native_bytes_keep_lr_frame_order() {
    let samples = [0x1234i16, 0x5678, -1, 0x0001];
    let wav = write_wav_s16(44_100, 2, &samples);
    let source = MediaSource::from_bytes("lr.wav", wav);
    let mut decoder = PcmDecoder::open(source).expect("open wav");
    decoder.decode_next().expect("decode").expect("samples");
    assert_eq!(decoder.last_repr().as_str(), "s16");
    assert_eq!(
        decoder.last_bytes(),
        &[0x34, 0x12, 0x78, 0x56, 0xFF, 0xFF, 0x01, 0x00]
    );
    let bytes = decoder.last_bytes();
    assert_eq!(&bytes[0..2], &[0x34, 0x12]);
    assert_eq!(&bytes[2..4], &[0x78, 0x56]);
}

#[test]
fn wav_s16_matches_s32_left_justified_downpack() {
    // WAV 16/44.1 (true S16) and FLAC-style S32 left-justified 16-bit must
    // produce the same PCM16 interleaved wire.
    let samples = [0x1234i16, 0x5678, -1, 0x0001];
    let wav = write_wav_s16(44_100, 2, &samples);
    let source = MediaSource::from_bytes("lr.wav", wav);
    let mut decoder = PcmDecoder::open(source).expect("open wav");
    decoder.decode_next().expect("decode").expect("samples");
    let wav_bytes = decoder.last_bytes().to_vec();

    let s32: Vec<i32> = samples.iter().map(|s| i32::from(*s) << 16).collect();
    let mut packed = Vec::new();
    nnpm_audio_core::pack_s32_left_justified(&s32, 16, &mut packed);
    assert_eq!(wav_bytes, packed);
}
