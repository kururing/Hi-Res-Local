use tauri::State;

use crate::models::browse::SearchResults;
use crate::search::fuzzy::fuzzy_search_all;
use crate::state::AppState;

#[tauri::command]
pub async fn search_library(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<SearchResults, String> {
    let limit_val = limit.unwrap_or(20);
    fuzzy_search_all(&state.db, &query, limit_val).map_err(|e| e.to_string())
}
