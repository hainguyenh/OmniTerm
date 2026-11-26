//! A small backtracking matcher for the agent quota parsers.
//!
//! The parsers were written against JavaScript regular expressions, and which line or which part
//! of a line they accept depends on regex semantics: greedy quantifiers that give characters back,
//! alternatives tried in order, word boundaries and look-ahead. The workspace carries no regex
//! crate for `app-core`, so the handful of constructs those patterns use are expressed here as
//! static token lists and matched with the same leftmost, priority-ordered backtracking.
//!
//! Literals compare ASCII case-insensitively, as every ported pattern carried the `i` flag.

/// Capture spans, as char indices into the subject.
pub(crate) type Caps = [Option<(usize, usize)>; 4];

pub(crate) enum Tok {
    /// ASCII case-insensitive literal.
    Lit(&'static str),
    /// `class{min,max}`, greedy.
    Class(fn(char) -> bool, usize, usize),
    /// `(?:...)?`, greedy.
    Opt(&'static [Tok]),
    /// `(?:a|b|...)`, tried in order.
    Alt(&'static [&'static [Tok]]),
    /// `(?:...)+`, greedy.
    Plus(&'static [Tok]),
    /// Capturing group `n`.
    Cap(usize, &'static [Tok]),
    /// Positive look-ahead.
    Ahead(&'static [Tok]),
    /// `^`
    Start,
    /// `$`
    End,
    /// `\b`
    Boundary,
}

pub(crate) const MANY: usize = usize::MAX;

pub(crate) fn is_digit(c: char) -> bool {
    c.is_ascii_digit()
}

pub(crate) fn is_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

pub(crate) fn is_alpha(c: char) -> bool {
    c.is_ascii_alphabetic()
}

/// `\w` in a JavaScript regex without the `u` flag.
pub(crate) fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// One successful match: its char span and its captures.
pub(crate) struct Found {
    pub start: usize,
    pub end: usize,
    pub caps: Caps,
}

impl Found {
    /// Capture `n` as a string, when that group took part in the match.
    pub fn group(&self, chars: &[char], n: usize) -> Option<String> {
        self.caps[n].map(|(from, to)| chars[from..to].iter().collect())
    }
}

type Cont<'a> = &'a mut dyn FnMut(usize, &mut Caps) -> bool;

fn lit_at(subject: &[char], pos: usize, lit: &str) -> Option<usize> {
    let mut at = pos;
    for expected in lit.chars() {
        let actual = *subject.get(at)?;
        if !actual.eq_ignore_ascii_case(&expected) {
            return None;
        }
        at += 1;
    }
    Some(at)
}

fn boundary(subject: &[char], pos: usize) -> bool {
    let before = pos > 0 && is_word(subject[pos - 1]);
    let after = pos < subject.len() && is_word(subject[pos]);
    before != after
}

fn plus(
    inner: &[Tok],
    rest: &[Tok],
    subject: &[char],
    pos: usize,
    caps: &mut Caps,
    k: Cont,
) -> bool {
    let mut next = |at: usize, caps: &mut Caps| {
        if at > pos && plus(inner, rest, subject, at, caps, &mut *k) {
            return true;
        }
        seq(rest, subject, at, caps, &mut *k)
    };
    seq(inner, subject, pos, caps, &mut next)
}

fn seq(tokens: &[Tok], subject: &[char], pos: usize, caps: &mut Caps, k: Cont) -> bool {
    let Some((first, rest)) = tokens.split_first() else {
        return k(pos, caps);
    };
    match first {
        Tok::Lit(lit) => match lit_at(subject, pos, lit) {
            Some(at) => seq(rest, subject, at, caps, k),
            None => false,
        },
        Tok::Class(test, min, max) => {
            let mut count = 0;
            while count < *max && pos + count < subject.len() && test(subject[pos + count]) {
                count += 1;
            }
            if count < *min {
                return false;
            }
            loop {
                if seq(rest, subject, pos + count, caps, &mut *k) {
                    return true;
                }
                if count == *min {
                    return false;
                }
                count -= 1;
            }
        }
        Tok::Opt(inner) => {
            {
                let mut then = |at: usize, caps: &mut Caps| seq(rest, subject, at, caps, &mut *k);
                if seq(inner, subject, pos, caps, &mut then) {
                    return true;
                }
            }
            seq(rest, subject, pos, caps, k)
        }
        Tok::Alt(options) => options.iter().any(|option| {
            let mut then = |at: usize, caps: &mut Caps| seq(rest, subject, at, caps, &mut *k);
            seq(option, subject, pos, caps, &mut then)
        }),
        Tok::Plus(inner) => plus(inner, rest, subject, pos, caps, k),
        Tok::Cap(index, inner) => {
            let index = *index;
            let mut then = |at: usize, caps: &mut Caps| {
                let previous = caps[index];
                caps[index] = Some((pos, at));
                if seq(rest, subject, at, caps, &mut *k) {
                    return true;
                }
                caps[index] = previous;
                false
            };
            seq(inner, subject, pos, caps, &mut then)
        }
        Tok::Ahead(inner) => {
            let mut probe = *caps;
            seq(inner, subject, pos, &mut probe, &mut |_, _| true)
                && seq(rest, subject, pos, caps, k)
        }
        Tok::Start => pos == 0 && seq(rest, subject, pos, caps, k),
        Tok::End => pos == subject.len() && seq(rest, subject, pos, caps, k),
        Tok::Boundary => boundary(subject, pos) && seq(rest, subject, pos, caps, k),
    }
}

/// Match `pattern` anchored at `pos`.
pub(crate) fn match_at(pattern: &[Tok], subject: &[char], pos: usize) -> Option<Found> {
    let mut caps: Caps = [None; 4];
    let mut end = None;
    let matched = seq(pattern, subject, pos, &mut caps, &mut |at, _| {
        end = Some(at);
        true
    });
    match (matched, end) {
        (true, Some(end)) => Some(Found {
            start: pos,
            end,
            caps,
        }),
        _ => None,
    }
}

/// The leftmost match of `pattern` at or after `from`, like `RegExp.prototype.exec`.
pub(crate) fn find_from(pattern: &[Tok], subject: &[char], from: usize) -> Option<Found> {
    (from..=subject.len()).find_map(|pos| match_at(pattern, subject, pos))
}

pub(crate) fn find(pattern: &[Tok], subject: &[char]) -> Option<Found> {
    find_from(pattern, subject, 0)
}

pub(crate) fn test(pattern: &[Tok], text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    find(pattern, &chars).is_some()
}

/// Replace every non-overlapping match, left to right, like `String.prototype.replace` with a
/// global pattern.
pub(crate) fn replace_all(
    pattern: &[Tok],
    text: &str,
    replacement: &dyn Fn(&[char], &Found) -> String,
) -> String {
    let subject = chars(text);
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while let Some(found) = find_from(pattern, &subject, at) {
        out.push_str(&string(&subject[at..found.start]));
        out.push_str(&replacement(&subject, &found));
        if found.end == found.start {
            if let Some(c) = subject.get(found.end) {
                out.push(*c);
            }
            at = found.end + 1;
        } else {
            at = found.end;
        }
        if at > subject.len() {
            return out;
        }
    }
    out.push_str(&string(&subject[at..]));
    out
}

pub(crate) fn chars(text: &str) -> Vec<char> {
    text.chars().collect()
}

pub(crate) fn string(chars: &[char]) -> String {
    chars.iter().collect()
}

#[cfg(test)]
#[path = "pattern_tests.rs"]
mod tests;
