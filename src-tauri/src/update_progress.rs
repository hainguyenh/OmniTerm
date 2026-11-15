//! Update endpoint resolution and download-progress throttling for the native updater.
//!
//! These are OmniTerm desktop additions on top of the `ide_core::updates` types; they live here
//! because they serve the desktop updater, not the reusable IDE core.

use ide_core::updates::UpdateSource;
use serde::Serialize;

/// Secondary endpoint used for users whose region reaches GitHub slowly; always the fallback of the other source.
const CNB_ENDPOINT: &str = "https://cnb.cool/hainguyenh/OmniTerm/-/releases/latest/download/latest.json";

/// Unknown-length downloads report once per this many bytes.
const UNKNOWN_TOTAL_STEP: u64 = 256 * 1024;

/// Wire shape of the progress channel; field names follow `UpdateProgress` in `ui/ide/bindings.ts`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UpdateProgress {
    Downloading { downloaded: Option<u64>, total: Option<u64> },
    Installing,
}

/// Orders the update endpoints: the selected source first, the other one as fallback. A valid HTTPS
/// `custom` endpoint replaces the configured official ones; anything else is ignored.
pub fn source_endpoints(official: Vec<String>, source: UpdateSource, custom: Option<String>) -> Vec<String> {
    let base = match custom.map(|url| url.trim().to_owned()).filter(|url| url.starts_with("https://")) {
        Some(url) => vec![url],
        None => official,
    };
    let cnb_endpoint = CNB_ENDPOINT.to_owned();
    match source {
        UpdateSource::Github => base.into_iter().chain([cnb_endpoint]).collect(),
        UpdateSource::Cnb => [cnb_endpoint].into_iter().chain(base).collect(),
    }
}

/// Reports a download at whole-percent steps, or per 256 KiB when the server sends no length, so the
/// channel never floods the UI.
#[derive(Debug, Default)]
pub struct ProgressThrottle {
    downloaded: u64,
    last_step: Option<u64>,
}

impl ProgressThrottle {
    pub fn chunk(&mut self, len: usize, total: Option<u64>) -> Option<UpdateProgress> {
        self.downloaded += len as u64;
        let step = match total.filter(|total| *total > 0) {
            Some(total) => self.downloaded.min(total) * 100 / total,
            None => self.downloaded / UNKNOWN_TOTAL_STEP,
        };
        if self.last_step == Some(step) {
            return None;
        }
        self.last_step = Some(step);
        Some(UpdateProgress::Downloading { downloaded: Some(self.downloaded), total })
    }

    /// Bytes counted so far; the progress events carry the same number to the renderer.
    #[cfg(test)]
    pub fn downloaded(&self) -> u64 {
        self.downloaded
    }
}

#[cfg(test)]
#[path = "update_progress_tests.rs"]
mod tests;
