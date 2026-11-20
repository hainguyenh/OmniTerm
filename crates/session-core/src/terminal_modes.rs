//! The input modes the program in a session has switched on (DECSET `ESC [ ? Pm h`), so a pane that
//! attaches later gets them back.
//!
//! An attach replays only the last part of the output (see output.rs). A full-screen TUI such as
//! Claude Code switches mouse reporting on once, at start-up, and then redraws far more than the
//! replay keeps: the switch falls out of the buffer, and a freshly attached terminal never learns
//! that the program wants mouse clicks, bracketed paste or application cursor keys. Clicks then
//! select text instead of reaching the program. The tracker follows every switch as it streams by
//! and the replay ends with the ones still on.
//!
//! The alternate screen is not restored this way: entering it after the replay would blank what
//! the replay just drew.

use std::collections::BTreeSet;

const ESC: u8 = 0x1b;
/// Mode switches worth restoring: cursor keys, mouse reporting and its encodings, focus events,
/// bracketed paste. Any other private mode is ignored.
const TRACKED: [u16; 10] = [1, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 2004];
const CURSOR_VISIBLE: u16 = 25;
/// Longest unfinished escape sequence carried over to the next chunk; anything longer is not a
/// mode switch.
const MAX_PENDING: usize = 32;

#[derive(Debug, Default)]
pub(crate) struct TerminalModes {
    on: BTreeSet<u16>,
    cursor_hidden: bool,
    /// The start of an escape sequence the last chunk ended in.
    pending: Vec<u8>,
}

enum Scan {
    /// A complete sequence of this many bytes, a mode switch or not.
    Done(usize),
    /// The bytes end before the sequence does.
    Incomplete,
}

impl TerminalModes {
    /// Follow the mode switches in the next chunk of output.
    pub(crate) fn observe(&mut self, bytes: &[u8]) {
        if self.pending.is_empty() {
            self.scan(bytes);
            return;
        }
        let mut joined = std::mem::take(&mut self.pending);
        joined.extend_from_slice(bytes);
        self.scan(&joined);
    }

    /// The sequence that switches a fresh terminal into the modes now on.
    pub(crate) fn restore_sequence(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for mode in &self.on {
            out.extend_from_slice(format!("\x1b[?{mode}h").as_bytes());
        }
        if self.cursor_hidden {
            out.extend_from_slice(b"\x1b[?25l");
        }
        out
    }

    fn scan(&mut self, bytes: &[u8]) {
        let mut index = 0;
        while let Some(offset) = bytes[index..].iter().position(|&byte| byte == ESC) {
            let start = index + offset;
            match self.sequence(&bytes[start..]) {
                Scan::Done(length) => index = start + length,
                Scan::Incomplete => {
                    if bytes.len() - start <= MAX_PENDING {
                        self.pending = bytes[start..].to_vec();
                    }
                    return;
                }
            }
        }
    }

    /// Read the escape sequence `bytes` starts with, applying it when it switches a mode.
    fn sequence(&mut self, bytes: &[u8]) -> Scan {
        match bytes.get(1) {
            None => return Scan::Incomplete,
            // RIS, a full reset: every mode back to its default.
            Some(b'c') => {
                self.on.clear();
                self.cursor_hidden = false;
                return Scan::Done(2);
            }
            Some(b'[') => {}
            Some(_) => return Scan::Done(1),
        }
        match bytes.get(2) {
            None => return Scan::Incomplete,
            Some(b'?') => {}
            Some(_) => return Scan::Done(2),
        }
        let params = &bytes[3..];
        let Some(end) = params
            .iter()
            .position(|&byte| !(byte.is_ascii_digit() || byte == b';'))
        else {
            return Scan::Incomplete;
        };
        let enable = match params[end] {
            b'h' => true,
            b'l' => false,
            _ => return Scan::Done(3 + end),
        };
        for param in params[..end].split(|&byte| byte == b';') {
            let mode = std::str::from_utf8(param)
                .ok()
                .and_then(|text| text.parse::<u16>().ok());
            match mode {
                Some(CURSOR_VISIBLE) => self.cursor_hidden = !enable,
                Some(mode) if TRACKED.contains(&mode) => {
                    if enable {
                        self.on.insert(mode);
                    } else {
                        self.on.remove(&mode);
                    }
                }
                _ => {}
            }
        }
        Scan::Done(3 + end + 1)
    }
}

#[cfg(test)]
#[path = "terminal_modes_tests.rs"]
mod tests;
