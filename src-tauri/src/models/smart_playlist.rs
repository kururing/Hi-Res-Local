use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MatchType {
    All,
    Any,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SmartField {
    Title,
    Artist,
    Album,
    Genre,
    Year,
    Rating,
    PlayCount,
    SkipCount,
    Bitrate,
    DurationMs,
    Format,
    IsFavorite,
    DateAdded,
    LastPlayedAt,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SmartOperator {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    StartsWith,
    EndsWith,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
    InTheLastDays,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SmartRule {
    pub field: SmartField,
    pub operator: SmartOperator,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SmartSortBy {
    Title,
    Artist,
    Album,
    Year,
    DateAdded,
    LastPlayedAt,
    PlayCount,
    Rating,
    Duration,
    Random,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SortOrder {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SmartPlaylistDefinition {
    pub match_type: MatchType,
    pub rules: Vec<SmartRule>,
    pub limit: Option<u32>,
    pub sort_by: Option<SmartSortBy>,
    pub sort_order: Option<SortOrder>,
}
