use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;

use crate::db::queries_library::{get_albums, get_artists, get_genres};
use crate::db::queries_playlists::get_playlists;
use crate::db::queries_tracks::get_tracks;
use crate::db::Database;
use crate::error::AppResult;
use crate::models::browse::SearchResults;

pub fn fuzzy_search_all(
    db: &Database,
    query: &str,
    limit_per_category: usize,
) -> AppResult<SearchResults> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(SearchResults {
            query: query.to_string(),
            tracks: Vec::new(),
            albums: Vec::new(),
            artists: Vec::new(),
            genres: Vec::new(),
            playlists: Vec::new(),
        });
    }

    let matcher = SkimMatcherV2::default();
    let conn = db.lock();

    // 1. Search tracks
    let all_tracks = get_tracks(&conn, None)?;
    let mut scored_tracks: Vec<(i64, _)> = all_tracks
        .into_iter()
        .filter(|t| !t.is_corrupt)
        .filter_map(|t| {
            let s1 = matcher.fuzzy_match(&t.title, q).unwrap_or(0);
            let s2 = matcher.fuzzy_match(&t.artist, q).unwrap_or(0);
            let s3 = matcher.fuzzy_match(&t.album, q).unwrap_or(0);
            let max_score = s1.max(s2).max(s3);
            if max_score > 0 {
                Some((max_score, t))
            } else {
                None
            }
        })
        .collect();
    scored_tracks.sort_by_key(|item| std::cmp::Reverse(item.0));
    let matched_tracks = scored_tracks
        .into_iter()
        .take(limit_per_category)
        .map(|(_, t)| t)
        .collect();

    // 2. Search albums
    let all_albums = get_albums(&conn)?;
    let mut scored_albums: Vec<(i64, _)> = all_albums
        .into_iter()
        .filter_map(|a| {
            let s1 = matcher.fuzzy_match(&a.title, q).unwrap_or(0);
            let s2 = matcher.fuzzy_match(&a.artist, q).unwrap_or(0);
            let max_score = s1.max(s2);
            if max_score > 0 {
                Some((max_score, a))
            } else {
                None
            }
        })
        .collect();
    scored_albums.sort_by_key(|item| std::cmp::Reverse(item.0));
    let matched_albums = scored_albums
        .into_iter()
        .take(limit_per_category)
        .map(|(_, a)| a)
        .collect();

    // 3. Search artists
    let all_artists = get_artists(&conn)?;
    let mut scored_artists: Vec<(i64, _)> = all_artists
        .into_iter()
        .filter_map(|a| {
            let score = matcher.fuzzy_match(&a.name, q).unwrap_or(0);
            if score > 0 {
                Some((score, a))
            } else {
                None
            }
        })
        .collect();
    scored_artists.sort_by_key(|item| std::cmp::Reverse(item.0));
    let matched_artists = scored_artists
        .into_iter()
        .take(limit_per_category)
        .map(|(_, a)| a)
        .collect();

    // 4. Search genres
    let all_genres = get_genres(&conn)?;
    let mut scored_genres: Vec<(i64, _)> = all_genres
        .into_iter()
        .filter_map(|g| {
            let score = matcher.fuzzy_match(&g.name, q).unwrap_or(0);
            if score > 0 {
                Some((score, g))
            } else {
                None
            }
        })
        .collect();
    scored_genres.sort_by_key(|item| std::cmp::Reverse(item.0));
    let matched_genres = scored_genres
        .into_iter()
        .take(limit_per_category)
        .map(|(_, g)| g)
        .collect();

    // 5. Search playlists
    let all_playlists = get_playlists(&conn)?;
    let mut scored_playlists: Vec<(i64, _)> = all_playlists
        .into_iter()
        .filter_map(|p| {
            let score = matcher.fuzzy_match(&p.name, q).unwrap_or(0);
            if score > 0 {
                Some((score, p))
            } else {
                None
            }
        })
        .collect();
    scored_playlists.sort_by_key(|item| std::cmp::Reverse(item.0));
    let matched_playlists = scored_playlists
        .into_iter()
        .take(limit_per_category)
        .map(|(_, p)| p)
        .collect();

    Ok(SearchResults {
        query: query.to_string(),
        tracks: matched_tracks,
        albums: matched_albums,
        artists: matched_artists,
        genres: matched_genres,
        playlists: matched_playlists,
    })
}
