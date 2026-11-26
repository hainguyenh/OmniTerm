//! Where an `ssh` command line connects: user, host and port, read the way OpenSSH reads its own
//! arguments. Used to list the SSH sessions a user started by hand in a local terminal, so they can
//! be saved as connections. Pure over the argument list; nothing here touches a process.

#[cfg(test)]
#[path = "ssh_target_tests.rs"]
mod tests;

/// The destination of one `ssh` invocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshTarget {
    pub user: Option<String>,
    pub host: String,
    pub port: Option<String>,
}

/// OpenSSH options that take a value (`ssh(1)`): the value is the rest of the argument
/// (`-p22`) or the next argument (`-p 22`).
const VALUE_OPTIONS: &str = "BbcDEeFIiJLlmOoPpQRSWw";

/// A host or user taken from a command line: one token that cannot be read as an option.
fn plain_token(value: &str) -> Option<String> {
    (!value.is_empty()
        && !value.starts_with('-')
        && !value.chars().any(|c| c.is_whitespace() || c.is_control()))
    .then(|| value.to_string())
}

fn valid_port(value: &str) -> Option<String> {
    matches!(value.parse::<u16>(), Ok(port) if port > 0).then(|| value.to_string())
}

/// `-o Port=2222`, `-o "User admin"`: the two `-o` settings that change the destination.
fn apply_setting(setting: &str, user: &mut Option<String>, port: &mut Option<String>) {
    let (key, value) = match setting.split_once('=') {
        Some((key, value)) => (key, value),
        None => setting
            .split_once(char::is_whitespace)
            .unwrap_or((setting, "")),
    };
    let value = value.trim();
    if key.trim().eq_ignore_ascii_case("port") {
        *port = valid_port(value).or(port.take());
    } else if key.trim().eq_ignore_ascii_case("user") {
        *user = plain_token(value).or(user.take());
    }
}

/// `[user@]host`, or `ssh://[user@]host[:port]` (an IPv6 host in brackets).
fn parse_destination(arg: &str) -> Option<SshTarget> {
    if let Some(uri) = arg.strip_prefix("ssh://") {
        let uri = uri.trim_end_matches('/');
        let (user, rest) = match uri.rsplit_once('@') {
            Some((user, rest)) => (plain_token(user), rest),
            None => (None, uri),
        };
        let (host, port) = if let Some(bracketed) = rest.strip_prefix('[') {
            let (host, after) = bracketed.split_once(']')?;
            (host, after.strip_prefix(':').and_then(valid_port))
        } else {
            match rest.rsplit_once(':') {
                Some((host, port)) => (host, valid_port(port)),
                None => (rest, None),
            }
        };
        return Some(SshTarget {
            user,
            host: plain_token(host)?,
            port,
        });
    }
    let (user, host) = match arg.rsplit_once('@') {
        Some((user, host)) => (plain_token(user), host),
        None => (None, arg),
    };
    Some(SshTarget {
        user,
        host: plain_token(host)?,
        port: None,
    })
}

/// The destination of `args` (the full command line, executable first). None for an invocation
/// with no destination, such as `ssh -V`. `-l` and `-p` win over the destination's own user, as in
/// OpenSSH when they come first; a port in an `ssh://` URI is used when `-p` is absent.
pub fn parse_ssh_args(args: &[String]) -> Option<SshTarget> {
    let mut user: Option<String> = None;
    let mut port: Option<String> = None;
    let mut rest = args.iter().skip(1);
    let mut options_done = false;
    while let Some(arg) = rest.next() {
        if options_done || !arg.starts_with('-') || arg == "-" {
            let mut target = parse_destination(arg)?;
            if user.is_some() {
                target.user = user;
            }
            if port.is_some() {
                target.port = port;
            }
            return Some(target);
        }
        if arg == "--" {
            options_done = true;
            continue;
        }
        let flags = &arg[1..];
        for (index, flag) in flags.char_indices() {
            if !VALUE_OPTIONS.contains(flag) {
                continue;
            }
            let attached = &flags[index + flag.len_utf8()..];
            let value = if attached.is_empty() {
                rest.next().map(String::as_str).unwrap_or_default()
            } else {
                attached
            };
            match flag {
                'l' => user = plain_token(value).or(user),
                'p' => port = valid_port(value).or(port),
                'o' => apply_setting(value, &mut user, &mut port),
                _ => {}
            }
            break;
        }
    }
    None
}
