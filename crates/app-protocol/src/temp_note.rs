use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TempNoteMeta {
    pub id: String,
    pub title: String,
    pub mtime_ms: u64,
    pub size: u64,
}
