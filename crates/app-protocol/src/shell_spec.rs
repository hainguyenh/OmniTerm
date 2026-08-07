//! Local shell identity: the closed set of shells OmniTerm will spawn, how each resolves to an
//! executable, and quote-aware tokenization of the user's extra-args string.
//!
//! The set is closed on purpose. The Electron build typed it as `'wsl' | 'powershell' | 'cmd'`
//! (plus the POSIX equivalents), so no caller could ever name an arbitrary executable. The Tauri
//! port must keep that property: a shell name reaches us from the webview AND from `--open-shell`
//! argv that any local process can write, so passing an unrecognized string through to
//! `CommandBuilder` would be arbitrary program execution.
//!
//! Resolution and arg splitting port `powershellExe` (electron/services/localPty.ts) and
//! `resolvePosixShell` / `parsePosixArgs` (electron/services/posixPty.ts).

use serde::{Deserialize, Serialize};
use std::path::Path;
#[cfg(target_os = "windows")]
use std::sync::OnceLock;

#[cfg(test)]
#[path = "shell_spec_tests.rs"]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalShell {
    Wsl,
    Powershell,
    Cmd,
    Bash,
    Sh,
    Zsh,
    /// The platform's own default: PowerShell on Windows, `$SHELL` on POSIX.
    Default,
}

impl LocalShell {
    /// Parse a shell name from an untrusted string. Returns `None` for anything outside the set —
    /// callers must treat that as a rejected request, never as "spawn it anyway".
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "wsl" => Some(Self::Wsl),
            "powershell" => Some(Self::Powershell),
            "cmd" => Some(Self::Cmd),
            "bash" => Some(Self::Bash),
            "sh" => Some(Self::Sh),
            "zsh" => Some(Self::Zsh),
            "default" | "" => Some(Self::Default),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wsl => "wsl",
            Self::Powershell => "powershell",
            Self::Cmd => "cmd",
            Self::Bash => "bash",
            Self::Sh => "sh",
            Self::Zsh => "zsh",
            Self::Default => "default",
        }
    }

    /// True if this shell can exist on the running platform. `wsl`/`powershell`/`cmd` are
    /// Windows-only; `bash`/`sh`/`zsh` are POSIX-only. Keeps a cross-platform request (a Windows
    /// backup imported on a Mac, say) from reaching `spawn_command`.
    pub fn is_supported_here(self) -> bool {
        let windows_only = matches!(self, Self::Wsl | Self::Powershell | Self::Cmd);
        let posix_only = matches!(self, Self::Bash | Self::Sh | Self::Zsh);
        if cfg!(target_os = "windows") {
            !posix_only
        } else {
            !windows_only
        }
    }

    /// The tab label shown for this shell. Ports Electron's `shellLabel`.
    pub fn label(self) -> &'static str {
        match self {
            Self::Powershell => "PowerShell",
            Self::Cmd => "Command Prompt",
            Self::Wsl => "WSL",
            Self::Default => "Default shell",
            Self::Zsh => "Z shell",
            Self::Bash => "Bash",
            Self::Sh => "POSIX shell",
        }
    }

    /// The label used when a launch request carries no `--name`. Ports Electron's `defaultName`.
    pub fn default_name(self) -> &'static str {
        match self {
            Self::Powershell => "PowerShell",
            Self::Cmd => "Command Prompt",
            Self::Wsl => "WSL",
            other => other.label(),
        }
    }

    /// The executable to spawn, or an error naming what is missing.
    ///
    /// Returning `Result` rather than a best-guess string matters on POSIX: Electron's
    /// `resolvePosixShell` reports "/bin/zsh is not installed or executable" instead of handing an
    /// unusable path to the spawner, where the failure surfaces as an opaque ENOENT.
    pub fn resolve_exe(self) -> Result<String, String> {
        if !self.is_supported_here() {
            return Err(format!(
                "the {} shell is not available on this platform",
                self.as_str()
            ));
        }

        #[cfg(target_os = "windows")]
        {
            Ok(match self {
                Self::Cmd => "cmd.exe".to_string(),
                Self::Wsl => "wsl.exe".to_string(),
                _ => powershell_exe().to_string(),
            })
        }

        #[cfg(not(target_os = "windows"))]
        {
            resolve_posix_shell(self, |p| is_executable(Path::new(p)))
        }
    }
}

/// True if `path` is absolute and executable. Ports Electron's `executable` guard.
#[cfg(not(target_os = "windows"))]
pub fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    if !path.is_absolute() {
        return false;
    }
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// POSIX shell resolution, with the executability probe injected so it can be tested without
/// depending on which shells happen to be installed on the test machine.
#[cfg(not(target_os = "windows"))]
pub fn resolve_posix_shell(
    shell: LocalShell,
    is_exec: impl Fn(&str) -> bool,
) -> Result<String, String> {
    if shell == LocalShell::Default {
        if let Ok(env_shell) = std::env::var("SHELL") {
            if is_exec(&env_shell) {
                return Ok(env_shell);
            }
        }
    }
    let requested = if shell == LocalShell::Default {
        "zsh"
    } else {
        shell.as_str()
    };
    let candidate = format!("/bin/{requested}");
    if is_exec(&candidate) {
        return Ok(candidate);
    }
    if shell == LocalShell::Default && is_exec("/bin/bash") {
        return Ok("/bin/bash".to_string());
    }
    Err(format!("{candidate} is not installed or executable."))
}

/// True if `exe` is found in any PATH directory. Ports Electron's `isOnPath`.
pub fn is_on_path(exe: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|dir| {
        if dir.as_os_str().is_empty() {
            return false;
        }
        Path::new(&dir).join(exe).exists()
    })
}

/// Prefer PowerShell 7 (`pwsh.exe`) when installed, else Windows PowerShell 5. Detected once and
/// cached — the user's install does not change mid-session. Ports Electron's `powershellExe`.
#[cfg(target_os = "windows")]
pub fn powershell_exe() -> &'static str {
    static CACHED: OnceLock<&'static str> = OnceLock::new();
    CACHED.get_or_init(|| {
        if is_on_path("pwsh.exe") {
            "pwsh.exe"
        } else {
            "powershell.exe"
        }
    })
}

/// Split a user-supplied extra-args string into individual argv entries.
///
/// Ports Electron's `parsePosixArgs`: single and double quotes group, and an unterminated quote is an
/// error rather than a silent mis-split. `CommandBuilder` takes arguments one at a time, so splitting
/// on whitespace alone (as the first port did) tore every quoted path with a space in it into pieces.
///
/// Backslash escaping is POSIX-only. On Windows a backslash is an ordinary path separator, and
/// applying POSIX rules there would quietly rewrite `-File C:\dir\x.ps1` into `C:dirx.ps1`. Electron
/// never split args on Windows at all — it built a raw command line — so treating `\` literally is
/// both what users expect and what the Electron build effectively did.
pub fn split_args(input: &str) -> Result<Vec<String>, String> {
    split_args_with(input, cfg!(not(target_os = "windows")))
}

/// `split_args` with the escaping rule injected, so both platforms' behavior is testable anywhere.
pub fn split_args_with(input: &str, backslash_escapes: bool) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut started = false;

    for ch in input.trim().chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            started = true;
        } else if backslash_escapes && ch == '\\' && quote != Some('\'') {
            escaped = true;
            started = true;
        } else if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else {
                current.push(ch);
            }
            started = true;
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
            started = true;
        } else if ch.is_whitespace() {
            if started {
                args.push(std::mem::take(&mut current));
                started = false;
            }
        } else {
            current.push(ch);
            started = true;
        }
    }

    if escaped {
        current.push('\\');
    }
    if quote.is_some() {
        return Err("Unterminated quote in extra arguments.".to_string());
    }
    if started {
        args.push(current);
    }
    Ok(args)
}

/// Quote a value for embedding in a POSIX shell command. Ports Electron's `shellQuote`.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}
