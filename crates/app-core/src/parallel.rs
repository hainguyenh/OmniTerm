//! A small work queue over scoped threads for file-system walks (the items are handed out one at
//! a time, so a few huge folders never leave the other threads idle behind a fixed split), and the
//! progress and cancellation those walks report through.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// How far a scan or a clean-up has got: entries handled of the entries planned, bytes so far.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub done: u64,
    pub total: u64,
    pub bytes: u64,
}

/// Progress reporting and cancellation of one scan or clean-up.
pub struct Progress<'a> {
    /// Called after every entry, from any worker thread; the caller throttles what it shows.
    pub on_step: &'a (dyn Fn(Step) + Sync),
    /// Once set, the walk stops at the next file and returns what it has.
    pub cancel: &'a AtomicBool,
}

impl Progress<'_> {
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

/// Counters the workers of one walk share.
#[derive(Default)]
pub struct Tally {
    done: AtomicU64,
    bytes: AtomicU64,
}

impl Tally {
    /// Counts one finished entry of `bytes` and reports the new totals.
    pub fn finish(&self, bytes: u64, total: u64, progress: &Progress<'_>) {
        let done = self.done.fetch_add(1, Ordering::Relaxed) + 1;
        let bytes = self.bytes.fetch_add(bytes, Ordering::Relaxed) + bytes;
        (progress.on_step)(Step { done, total, bytes });
    }
}

/// Threads a walk uses at most: the work is file-system I/O, not CPU.
const MAX_WORKERS: usize = 8;

/// Threads for `items` items: one per item up to the machine's parallelism and [`MAX_WORKERS`].
fn workers_for(items: usize) -> usize {
    std::thread::available_parallelism()
        .map_or(1, std::num::NonZeroUsize::get)
        .min(MAX_WORKERS)
        .min(items)
        .max(1)
}

/// `f` applied to every item on a few threads; the results keep the items' order. A worker that
/// panics loses the items it had taken (they are left out); the others still finish.
pub fn par_map<T, R, F>(items: Vec<T>, f: F) -> Vec<R>
where
    T: Send,
    R: Send,
    F: Fn(T) -> R + Sync,
{
    let count = items.len();
    if count < 2 {
        return items.into_iter().map(f).collect();
    }
    let queue = Mutex::new(items.into_iter().enumerate());
    let next = || queue.lock().ok().and_then(|mut items| items.next());
    let mut done: Vec<(usize, R)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers_for(count))
            .map(|_| {
                scope.spawn(|| {
                    let mut out = Vec::new();
                    while let Some((index, item)) = next() {
                        out.push((index, f(item)));
                    }
                    out
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap_or_default())
            .collect()
    });
    done.sort_unstable_by_key(|(index, _)| *index);
    done.into_iter().map(|(_, result)| result).collect()
}

#[cfg(test)]
mod tests {
    use super::par_map;

    #[test]
    fn results_keep_the_order_of_the_items() {
        let items: Vec<u64> = (0..500).collect();
        let doubled = par_map(items, |n| n * 2);
        assert_eq!(doubled, (0..500).map(|n| n * 2).collect::<Vec<_>>());
    }

    #[test]
    fn small_inputs_run_inline() {
        assert_eq!(par_map(vec![3], |n: i32| n + 1), vec![4]);
        assert!(par_map(Vec::<i32>::new(), |n| n).is_empty());
    }
}
