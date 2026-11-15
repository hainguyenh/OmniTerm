//! Terminal escape sequences stripped from captured CLI output before the usage parsers read it.

use super::pattern::chars;

/// Remove OSC sequences (`ESC ] … BEL` or `ESC ] … ESC \`).
fn strip_osc(text: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    'scan: while at < text.len() {
        if text[at] == '\u{1b}' && text.get(at + 1) == Some(&']') {
            let mut end = at + 2;
            while end < text.len() && text[end] != '\u{7}' && text[end] != '\u{1b}' {
                end += 1;
            }
            if text.get(end) == Some(&'\u{7}') {
                at = end + 1;
                continue 'scan;
            }
            if text.get(end) == Some(&'\u{1b}') && text.get(end + 1) == Some(&'\\') {
                at = end + 2;
                continue 'scan;
            }
        }
        out.push(text[at]);
        at += 1;
    }
    out
}

/// Remove CSI sequences: `ESC [`, parameters `[0-9;?]*`, intermediates `[ -/]*`, a final `[@-~]`.
fn strip_csi(text: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        if text[at] == '\u{1b}' && text.get(at + 1) == Some(&'[') {
            let mut end = at + 2;
            while end < text.len()
                && (text[end].is_ascii_digit() || text[end] == ';' || text[end] == '?')
            {
                end += 1;
            }
            while end < text.len() && (' '..='/').contains(&text[end]) {
                end += 1;
            }
            if end < text.len() && ('@'..='~').contains(&text[end]) {
                at = end + 1;
                continue;
            }
        }
        out.push(text[at]);
        at += 1;
    }
    out
}

/// Remove two-character escapes `ESC [@-_]`, then carriage returns.
fn strip_escapes(text: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        if text[at] == '\u{1b}' && text.get(at + 1).is_some_and(|c| ('@'..='_').contains(c)) {
            at += 2;
            continue;
        }
        if text[at] != '\r' {
            out.push(text[at]);
        }
        at += 1;
    }
    out
}

/// Terminal escapes removed, as both parsers need first.
pub(crate) fn strip_terminal(raw: &str) -> Vec<char> {
    strip_escapes(&strip_csi(&strip_osc(&chars(raw))))
}
