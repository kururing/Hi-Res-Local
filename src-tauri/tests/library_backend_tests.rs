use nghenhacpromax_lib::db::backup::{backup_database, restore_database};
use nghenhacpromax_lib::db::queries_history::{get_play_history, record_play_history};
use nghenhacpromax_lib::db::queries_library::{
    add_library_root, get_library_roots, remove_library_root,
};
use nghenhacpromax_lib::db::queries_playlists::{
    add_tracks_to_playlist, create_playlist, evaluate_smart_playlist_tracks,
    export_playlist_to_m3u, get_playlist_with_tracks, import_playlist_from_m3u,
    reorder_playlist_tracks,
};
use nghenhacpromax_lib::db::queries_tracks::{
    get_track_by_id, get_tracks, set_track_favorite, set_track_rating, upsert_track,
};
use nghenhacpromax_lib::db::Database;
use nghenhacpromax_lib::models::history::RecordPlayInput;
use nghenhacpromax_lib::models::playlist::{CreatePlaylistInput, Playlist};
use nghenhacpromax_lib::models::smart_playlist::{
    MatchType, SmartField, SmartOperator, SmartPlaylistDefinition, SmartRule, SmartSortBy,
    SortOrder,
};
use nghenhacpromax_lib::models::track::{Track, TrackFilter, TrackSortField};
use nghenhacpromax_lib::scanner::duplicate_detector::detect_and_assign_duplicates;
use tempfile::tempdir;

fn create_sample_track(id: &str, title: &str, artist: &str, album: &str, format: &str) -> Track {
    Track {
        id: id.to_string(),
        path: format!("/music/{}.{}", id, format),
        title: title.to_string(),
        artist: artist.to_string(),
        album_artist: None,
        album: album.to_string(),
        genre: Some("Rock".to_string()),
        year: Some(2020),
        track_number: Some(1),
        disc_number: Some(1),
        duration_ms: 180_000,
        bitrate: Some(320_000),
        sample_rate: Some(44100),
        channels: Some(2),
        bit_depth: Some(16),
        format: format.to_string(),
        file_size: 5_000_000,
        file_modified_at: "2026-01-01T00:00:00Z".to_string(),
        date_added: "2026-01-01T00:00:00Z".to_string(),
        is_favorite: false,
        rating: 0,
        play_count: 0,
        skip_count: 0,
        last_played_at: None,
        cover_art_path: None,
        lyrics: None,
        has_synced_lyrics: false,
        is_corrupt: false,
        corrupt_reason: None,
        duplicate_group_id: None,
        is_primary: true,
    }
}

#[test]
fn test_database_initialization_and_track_crud() {
    let db = Database::open_in_memory().expect("Failed to open DB");
    let conn = db.lock();

    let track = create_sample_track(
        "t1",
        "Bohemian Rhapsody",
        "Queen",
        "A Night at the Opera",
        "flac",
    );
    upsert_track(&conn, &track).expect("Failed to insert track");

    let loaded = get_track_by_id(&conn, "t1")
        .expect("Failed to query")
        .expect("Track not found");
    assert_eq!(loaded.title, "Bohemian Rhapsody");
    assert_eq!(loaded.artist, "Queen");
    assert_eq!(loaded.format, "flac");

    set_track_favorite(&conn, "t1", true).expect("Failed to set favorite");
    set_track_rating(&conn, "t1", 5).expect("Failed to set rating");

    let updated = get_track_by_id(&conn, "t1")
        .expect("Failed to query")
        .unwrap();
    assert!(updated.is_favorite);
    assert_eq!(updated.rating, 5);
}

#[test]
fn test_track_filtering_and_sorting() {
    let db = Database::open_in_memory().expect("Failed to open DB");
    let conn = db.lock();

    let mut t1 = create_sample_track("t1", "Song A", "Artist 1", "Album X", "mp3");
    t1.rating = 4;
    t1.is_favorite = true;

    let mut t2 = create_sample_track("t2", "Song B", "Artist 2", "Album Y", "flac");
    t2.rating = 2;
    t2.is_favorite = false;

    upsert_track(&conn, &t1).unwrap();
    upsert_track(&conn, &t2).unwrap();

    let fav_filter = TrackFilter {
        search_query: None,
        artist: None,
        album: None,
        genre: None,
        is_favorite: Some(true),
        min_rating: None,
        is_corrupt: None,
        duplicate_only: None,
        sort_by: Some(TrackSortField::Title),
        sort_desc: Some(false),
        limit: None,
        offset: None,
    };
    let fav_tracks = get_tracks(&conn, Some(fav_filter)).unwrap();
    assert_eq!(fav_tracks.len(), 1);
    assert_eq!(fav_tracks[0].id, "t1");

    let rating_filter = TrackFilter {
        search_query: None,
        artist: None,
        album: None,
        genre: None,
        is_favorite: None,
        min_rating: Some(3),
        is_corrupt: None,
        duplicate_only: None,
        sort_by: None,
        sort_desc: None,
        limit: None,
        offset: None,
    };
    let rating_tracks = get_tracks(&conn, Some(rating_filter)).unwrap();
    assert_eq!(rating_tracks.len(), 1);
    assert_eq!(rating_tracks[0].id, "t1");
}

#[test]
fn test_library_roots_crud() {
    let db = Database::open_in_memory().expect("Failed to open DB");
    let conn = db.lock();

    let root = add_library_root(&conn, "/home/music/rock", "Rock Collection").unwrap();
    assert_eq!(root.name, "Rock Collection");

    let roots = get_library_roots(&conn).unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].path, "/home/music/rock");

    let removed = remove_library_root(&conn, &root.id).unwrap();
    assert!(removed);

    let empty_roots = get_library_roots(&conn).unwrap();
    assert!(empty_roots.is_empty());
}

#[test]
fn test_playlists_manual_and_reordering() {
    let db = Database::open_in_memory().expect("Failed to open DB");
    let mut conn = db.lock();

    let t1 = create_sample_track("t1", "Track 1", "Artist", "Album", "mp3");
    let t2 = create_sample_track("t2", "Track 2", "Artist", "Album", "mp3");
    let t3 = create_sample_track("t3", "Track 3", "Artist", "Album", "mp3");
    upsert_track(&conn, &t1).unwrap();
    upsert_track(&conn, &t2).unwrap();
    upsert_track(&conn, &t3).unwrap();

    let p_input = CreatePlaylistInput {
        name: "My Hits".to_string(),
        description: Some("Best tracks".to_string()),
        is_smart: Some(false),
        rules_json: None,
    };
    let playlist = create_playlist(&conn, &p_input).unwrap();

    add_tracks_to_playlist(
        &mut conn,
        &playlist.id,
        &["t1".to_string(), "t2".to_string(), "t3".to_string()],
    )
    .unwrap();

    let p_with_tracks = get_playlist_with_tracks(&conn, &playlist.id).unwrap();
    assert_eq!(p_with_tracks.tracks.len(), 3);
    assert_eq!(p_with_tracks.tracks[0].id, "t1");
    assert_eq!(p_with_tracks.tracks[1].id, "t2");
    assert_eq!(p_with_tracks.tracks[2].id, "t3");

    // Reorder: t3, t1, t2
    reorder_playlist_tracks(
        &mut conn,
        &playlist.id,
        &["t3".to_string(), "t1".to_string(), "t2".to_string()],
    )
    .unwrap();

    let reordered = get_playlist_with_tracks(&conn, &playlist.id).unwrap();
    assert_eq!(reordered.tracks[0].id, "t3");
    assert_eq!(reordered.tracks[1].id, "t1");
    assert_eq!(reordered.tracks[2].id, "t2");
}

#[test]
fn test_smart_playlist_evaluation() {
    let db = Database::open_in_memory().expect("Failed to open DB");
    let conn = db.lock();

    let mut t1 = create_sample_track("t1", "Rock Hit 1", "Band A", "Album 1", "flac");
    t1.rating = 5;
    t1.play_count = 12;

    let mut t2 = create_sample_track("t2", "Rock Hit 2", "Band A", "Album 1", "mp3");
    t2.rating = 3;
    t2.play_count = 4;

    let mut t3 = create_sample_track("t3", "Jazz Ballad", "Band B", "Album 2", "flac");
    t3.genre = Some("Jazz".to_string());
    t3.rating = 5;
    t3.play_count = 20;

    upsert_track(&conn, &t1).unwrap();
    upsert_track(&conn, &t2).unwrap();
    upsert_track(&conn, &t3).unwrap();

    let smart_def = SmartPlaylistDefinition {
        match_type: MatchType::All,
        rules: vec![
            SmartRule {
                field: SmartField::Genre,
                operator: SmartOperator::Equals,
                value: "Rock".to_string(),
            },
            SmartRule {
                field: SmartField::Rating,
                operator: SmartOperator::GreaterThanOrEqual,
                value: "4".to_string(),
            },
        ],
        limit: Some(10),
        sort_by: Some(SmartSortBy::PlayCount),
        sort_order: Some(SortOrder::Desc),
    };

    let rules_json = serde_json::to_string(&smart_def).unwrap();
    let smart_playlist = Playlist {
        id: "smart_1".to_string(),
        name: "Top Rock 4+ Stars".to_string(),
        description: None,
        is_smart: true,
        rules_json: Some(rules_json),
        cover_art_path: None,
        track_count: 0,
        total_duration_ms: 0,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    };

    let matched_tracks = evaluate_smart_playlist_tracks(&conn, &smart_playlist).unwrap();
    assert_eq!(matched_tracks.len(), 1);
    assert_eq!(matched_tracks[0].id, "t1");
}

#[test]
fn test_m3u_export_and_import() {
    let temp = tempdir().unwrap();
    let m3u_path = temp.path().join("playlist.m3u");

    let db = Database::open_in_memory().expect("Failed to open DB");
    let mut conn = db.lock();

    let t1 = create_sample_track("t1", "Export 1", "Artist 1", "Album 1", "mp3");
    let t2 = create_sample_track("t2", "Export 2", "Artist 2", "Album 2", "mp3");
    upsert_track(&conn, &t1).unwrap();
    upsert_track(&conn, &t2).unwrap();

    let p_input = CreatePlaylistInput {
        name: "Export Test".to_string(),
        description: None,
        is_smart: Some(false),
        rules_json: None,
    };
    let playlist = create_playlist(&conn, &p_input).unwrap();
    add_tracks_to_playlist(
        &mut conn,
        &playlist.id,
        &["t1".to_string(), "t2".to_string()],
    )
    .unwrap();

    let exported_count = export_playlist_to_m3u(&conn, &playlist.id, &m3u_path).unwrap();
    assert_eq!(exported_count, 2);
    assert!(m3u_path.exists());

    let imported =
        import_playlist_from_m3u(&mut conn, &m3u_path, Some("Imported Test".to_string())).unwrap();
    assert_eq!(imported.playlist.name, "Imported Test");
    assert_eq!(imported.tracks.len(), 2);
}

#[test]
fn test_play_history_and_counters() {
    let db = Database::open_in_memory().expect("Failed to open DB");
    let conn = db.lock();

    let track = create_sample_track("t1", "History Track", "Artist", "Album", "flac");
    upsert_track(&conn, &track).unwrap();

    let input = RecordPlayInput {
        track_id: "t1".to_string(),
        completed_duration_ms: 180_000,
        fully_played: true,
    };

    let entry = record_play_history(&conn, &input).unwrap();
    assert_eq!(entry.track_id, "t1");
    assert!(entry.fully_played);

    let history = get_play_history(&conn, 10, 0).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].track_id, "t1");

    let reloaded_track = get_track_by_id(&conn, "t1").unwrap().unwrap();
    assert_eq!(reloaded_track.play_count, 1);
}

#[test]
fn test_duplicate_detection_ranking() {
    let mut tracks = vec![
        create_sample_track("t1", "Imagine", "John Lennon", "Imagine", "mp3"),
        create_sample_track("t2", "Imagine", "John Lennon", "Imagine", "flac"),
    ];
    tracks[0].bitrate = Some(128_000);
    tracks[1].bitrate = Some(900_000);

    detect_and_assign_duplicates(&mut tracks);

    assert!(tracks[0].duplicate_group_id.is_some());
    assert_eq!(tracks[0].duplicate_group_id, tracks[1].duplicate_group_id);
    assert!(!tracks[0].is_primary);
    assert!(tracks[1].is_primary); // FLAC with higher bitrate is elected primary
}

#[test]
fn test_database_backup_and_restore() {
    let temp = tempdir().unwrap();
    let backup_path = temp.path().join("backup.db");

    let db1 = Database::open_in_memory().unwrap();
    {
        let conn1 = db1.lock();
        let t1 = create_sample_track("t1", "Backup Song", "Artist", "Album", "flac");
        upsert_track(&conn1, &t1).unwrap();
        backup_database(&conn1, &backup_path).unwrap();
    }

    assert!(backup_path.exists());

    let db2 = Database::open_in_memory().unwrap();
    {
        let mut conn2 = db2.lock();
        restore_database(&mut conn2, &backup_path).unwrap();
        let restored_track = get_track_by_id(&conn2, "t1").unwrap();
        assert!(restored_track.is_some());
        assert_eq!(restored_track.unwrap().title, "Backup Song");
    }
}
