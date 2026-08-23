use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub group_key: String,
    pub primary_track: crate::models::track::Track,
    pub duplicates: Vec<crate::models::track::Track>,
}
