use crate::audio::adapters::{
    ExclusiveAudioAdapter, FallbackMediaControlsAdapter, MediaControlsAdapter, StandardAudioAdapter,
};
use crate::audio::device::{convert_f32_to_i16, convert_f32_to_u16};
use crate::audio::dsp::{CrossfadeProcessor, EqualizerProcessor, ReplayGainProcessor};
use crate::audio::dto::*;
use crate::audio::gapless::LinearResampler;
use crate::audio::queue::PlaybackQueue;

fn mock_track(id: &str, title: &str, duration_ms: u64) -> AudioTrack {
    AudioTrack {
        id: id.to_string(),
        path: format!("/music/{}.flac", id),
        title: title.to_string(),
        artist: "Test Artist".to_string(),
        album: "Test Album".to_string(),
        duration_ms,
        track_number: Some(1),
        year: Some(2024),
        genre: Some("Electronic".to_string()),
        replay_gain: Some(ReplayGainInfo {
            track_gain_db: Some(-4.5),
            track_peak: Some(0.98),
            album_gain_db: Some(-5.0),
            album_peak: Some(1.0),
        }),
    }
}

#[test]
fn test_queue_full_lifecycle() {
    let mut q = PlaybackQueue::new();
    assert!(q.is_empty());
    assert_eq!(q.len(), 0);

    let t1 = mock_track("1", "Track 1", 180000);
    let t2 = mock_track("2", "Track 2", 200000);

    q.add_tracks(vec![t1.clone(), t2.clone()]);
    assert_eq!(q.len(), 2);
    assert_eq!(q.current_index(), Some(0));

    // Play next
    let t_next = mock_track("next", "Play Next", 150000);
    q.play_next(t_next.clone());
    assert_eq!(q.len(), 3);
    assert_eq!(q.tracks()[1].id, "next");

    // Reorder
    q.reorder(1, 2).unwrap();
    assert_eq!(q.tracks()[2].id, "next");

    // Remove
    let removed = q.remove_track(2).unwrap();
    assert_eq!(removed.id, "next");
    assert_eq!(q.len(), 2);

    // Clear
    q.clear();
    assert_eq!(q.len(), 0);
    assert!(q.current_track().is_none());
}

#[test]
fn test_history_navigation_stack() {
    let mut q = PlaybackQueue::new();
    let t1 = mock_track("1", "Track 1", 180000);
    let t2 = mock_track("2", "Track 2", 200000);
    let t3 = mock_track("3", "Track 3", 220000);
    q.add_tracks(vec![t1, t2, t3]);

    q.set_current_index(0).unwrap();
    assert_eq!(q.current_track().unwrap().id, "1");

    q.next(); // now at 2
    assert_eq!(q.current_track().unwrap().id, "2");

    q.next(); // now at 3
    assert_eq!(q.current_track().unwrap().id, "3");

    // Back to 2
    let prev = q.previous().unwrap();
    assert_eq!(prev.id, "2");

    // Back to 1
    let prev2 = q.previous().unwrap();
    assert_eq!(prev2.id, "1");

    // Forward to 2
    let fwd = q.next().unwrap();
    assert_eq!(fwd.id, "2");
}

#[test]
fn test_repeat_modes_semantics() {
    let mut q = PlaybackQueue::new();
    let t1 = mock_track("1", "Track 1", 180000);
    let t2 = mock_track("2", "Track 2", 200000);
    q.add_tracks(vec![t1, t2]);

    // Repeat Off: stops at end
    q.set_repeat_mode(RepeatMode::Off);
    q.set_current_index(1).unwrap();
    assert!(q.next().is_none());

    // Repeat All: loops to start
    q.set_repeat_mode(RepeatMode::All);
    assert_eq!(q.next().unwrap().id, "1");

    // Repeat One: stays on same track
    q.set_repeat_mode(RepeatMode::One);
    assert_eq!(q.next().unwrap().id, "1");
    assert_eq!(q.next().unwrap().id, "1");
}

#[test]
fn test_weighted_shuffle_distribution() {
    let mut q = PlaybackQueue::new();
    for i in 0..8 {
        q.add_track(mock_track(
            &format!("{}", i),
            &format!("Song {}", i),
            180000,
        ));
    }

    q.set_shuffle_enabled(true);
    q.set_current_index(0).unwrap();

    let mut picks = vec![0; 8];
    for _ in 0..200 {
        let pick = q.pick_weighted_shuffle_next().unwrap();
        picks[pick] += 1;
    }

    // Index 0 was current track, should have penalty
    assert!(
        picks[0] < 10,
        "Current track must have very low pick count in weighted shuffle"
    );
    // Other tracks should be picked fairly
    let total_other: usize = picks[1..].iter().sum();
    assert!(total_other > 190);
}

#[test]
fn test_equalizer_filter_and_presets() {
    let mut eq_config = EqConfig::default();
    assert_eq!(eq_config.bands.len(), 10);

    // Apply Rock preset
    eq_config.apply_preset(EqPreset::Rock);
    assert_eq!(eq_config.preset, EqPreset::Rock);
    assert_eq!(eq_config.bands[0].gain_db, 4.0); // 31.25Hz boost
    assert_eq!(eq_config.bands[9].gain_db, 4.5); // 16kHz boost

    eq_config.enabled = true;
    let mut eq = EqualizerProcessor::new(44100, 2, &eq_config);

    let mut stereo_buf = vec![0.5f32; 256];
    eq.process_interleaved(&mut stereo_buf);

    for s in stereo_buf {
        assert!(s.is_finite());
    }
}

#[test]
fn test_replay_gain_calculation() {
    let config = ReplayGainConfig {
        mode: ReplayGainMode::Track,
        preamp_db: 3.0,
        prevent_clipping: true,
        fallback_gain_db: 0.0,
    };

    let info = ReplayGainInfo {
        track_gain_db: Some(-3.0),
        track_peak: Some(0.9),
        album_gain_db: Some(-4.0),
        album_peak: Some(1.0),
    };

    // Effective gain = -3.0 + 3.0 = 0.0 dB -> linear 1.0
    let linear = ReplayGainProcessor::calculate_linear_gain(&config, Some(&info));
    assert!((linear - 1.0).abs() < 1e-4);

    // Album mode
    let mut album_config = config.clone();
    album_config.mode = ReplayGainMode::Album;
    // Effective gain = -4.0 + 3.0 = -1.0 dB -> linear ~0.891
    let linear_album = ReplayGainProcessor::calculate_linear_gain(&album_config, Some(&info));
    assert!(linear_album < 0.95 && linear_album > 0.85);
}

#[test]
fn test_crossfade_equal_power() {
    let (g_out_0, g_in_0) = CrossfadeProcessor::calculate_gains(0.0, CrossfadeCurve::EqualPower);
    assert!((g_out_0 - 1.0).abs() < 1e-5);
    assert!((g_in_0 - 0.0).abs() < 1e-5);

    let (g_out_mid, g_in_mid) =
        CrossfadeProcessor::calculate_gains(0.5, CrossfadeCurve::EqualPower);
    assert!((g_out_mid - g_in_mid).abs() < 1e-5); // At 50%, both gains are equal ~0.7071
    assert!(((g_out_mid * g_out_mid + g_in_mid * g_in_mid) - 1.0).abs() < 1e-5);

    let (g_out_1, g_in_1) = CrossfadeProcessor::calculate_gains(1.0, CrossfadeCurve::EqualPower);
    assert!((g_out_1 - 0.0).abs() < 1e-5);
    assert!((g_in_1 - 1.0).abs() < 1e-5);
}

#[test]
fn test_resampler() {
    let mut resampler = LinearResampler::new(44100, 48000, 2);
    assert!(!resampler.is_identity());

    let input = vec![0.5; 100];
    let mut output = Vec::new();
    resampler.resample(&input, &mut output);
    assert!(!output.is_empty());
}

#[test]
fn test_sample_conversions() {
    assert_eq!(convert_f32_to_i16(0.0), 0);
    assert_eq!(convert_f32_to_i16(1.0), i16::MAX);
    assert_eq!(convert_f32_to_i16(-1.0), i16::MIN);

    assert_eq!(convert_f32_to_u16(0.0), 32767);
    assert_eq!(convert_f32_to_u16(1.0), 65535);
    assert_eq!(convert_f32_to_u16(-1.0), 0);
}

#[test]
fn test_quality_badge_computations() {
    assert!(QualityBadge::compute_is_hi_res(96000, Some(24)));
    assert!(QualityBadge::compute_is_hi_res(192000, Some(16)));
    assert!(QualityBadge::compute_is_hi_res(44100, Some(24)));
    assert!(!QualityBadge::compute_is_hi_res(44100, Some(16)));
}

#[test]
fn test_dto_serde_json_roundtrip() {
    let track = mock_track("t123", "Demo Song", 210000);
    let json = serde_json::to_string(&track).unwrap();
    let deserialized: AudioTrack = serde_json::from_str(&json).unwrap();
    assert_eq!(track, deserialized);

    let progress = PlaybackProgress {
        position_ms: 54000,
        duration_ms: 210000,
        buffered_ms: 54000,
        percentage: 0.257,
    };
    let json_p = serde_json::to_string(&progress).unwrap();
    let deserialized_p: PlaybackProgress = serde_json::from_str(&json_p).unwrap();
    assert_eq!(progress, deserialized_p);
}

#[test]
fn test_adapters_behavior() {
    let mut fallback_smtc = FallbackMediaControlsAdapter::new();
    assert!(!fallback_smtc.is_supported());
    assert!(fallback_smtc.poll_actions().is_empty());

    let mut standard_adapter = StandardAudioAdapter::new();
    standard_adapter.set_format(96000, 2);
    assert_eq!(standard_adapter.active_stream_format(), Some((96000, 2)));
}
