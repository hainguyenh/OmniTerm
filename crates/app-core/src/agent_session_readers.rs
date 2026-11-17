//! Reads the heads of the transcripts a listing keeps, a slice of them per thread: the files are
//! ranked by metadata first, so only these are opened.

use super::{describe, header_of, AgentSessionFile, Candidate};

/// Threads that read transcript heads at once: the work is file I/O plus a little JSON.
const HEADER_READERS: usize = 8;

/// Opens and parses each candidate's transcript head, a slice of them per thread.
pub(super) fn describe_all(candidates: Vec<Candidate<'_>>) -> Vec<AgentSessionFile> {
    let readers = std::thread::available_parallelism()
        .map_or(1, std::num::NonZeroUsize::get)
        .min(HEADER_READERS);
    let per_reader = candidates.len().div_ceil(readers).max(1);
    let mut batches: Vec<Vec<Candidate<'_>>> = Vec::new();
    let mut rest = candidates.into_iter();
    loop {
        let batch: Vec<Candidate<'_>> = rest.by_ref().take(per_reader).collect();
        if batch.is_empty() {
            break;
        }
        batches.push(batch);
    }
    std::thread::scope(|scope| {
        let workers: Vec<_> = batches
            .into_iter()
            .map(|batch| {
                scope.spawn(move || {
                    batch
                        .into_iter()
                        .filter_map(|candidate| {
                            let header = header_of(&candidate);
                            describe(candidate, header)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        workers
            .into_iter()
            // A reader that panicked loses its slice; the rest of the listing still shows.
            .flat_map(|worker| worker.join().unwrap_or_default())
            .collect()
    })
}
