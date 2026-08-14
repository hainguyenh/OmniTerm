//! How a LOCAL connection becomes an executable plus an argument vector.
//!
//! Ports `shellCommandLine` (electron/services/localPty.ts) and `posixShellCommand`
//! (electron/services/posixPty.ts). Two behaviors here were missing from the first Tauri port and
//! are the difference between "a shell opens" and "the saved connection actually runs":
//!
//!   * A saved `command` runs through the shell's own command switch (`cmd /k`, `powershell
//!     -NoExit -Command`, `sh -lc`), not by writing the text into the PTY's stdin. Writing to stdin
//!     races the shell's startup banner and ignores `keepOpen` entirely.
//!   * `keepOpen` (default true) decides whether the pane survives the command finishing — `/k` vs
//!     `/c`, `-NoExit` or not, `exec $SHELL -l` appended or not.

use app_protocol::shell_spec::{shell_quote, split_args, LocalShell};

/// Everything needed to start one local pane, after merging saved and ad-hoc params.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalLaunch {
    pub shell: LocalShell,
    pub cwd: Option<String>,
    pub args: Option<String>,
    pub command: Option<String>,
    /// Leave the pane open after `command` finishes so its final output stays visible.
    pub keep_open: bool,
}

/// A resolved executable and its argv (excluding argv[0]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub exe: String,
    pub args: Vec<String>,
}

/// Merge a saved connection's LOCAL fields with an optional shell override from the renderer.
///
/// The shell is validated here rather than at the spawn site, so an unrecognized name becomes an
/// error the user sees instead of an executable name handed to the process spawner.
#[allow(clippy::too_many_arguments)]
pub fn resolve_launch(
    saved_shell: Option<&str>,
    override_shell: Option<&str>,
    cwd: Option<String>,
    args: Option<String>,
    command: Option<String>,
    keep_open: Option<bool>,
) -> Result<LocalLaunch, String> {
    let requested = override_shell
        .filter(|s| !s.is_empty())
        .or(saved_shell)
        .unwrap_or("default");
    let shell = LocalShell::parse(requested)
        .ok_or_else(|| format!("Unsupported shell \"{requested}\"."))?;
    if !shell.is_supported_here() {
        return Err(format!(
            "The {} shell is not available on this platform.",
            shell.as_str()
        ));
    }

    Ok(LocalLaunch {
        shell,
        cwd: cwd.filter(|s| !s.is_empty()),
        args: args.filter(|s| !s.trim().is_empty()),
        command: command.filter(|s| !s.trim().is_empty()),
        // Absent means true, matching Electron's `keepOpen === false ? … : …` default.
        keep_open: keep_open.unwrap_or(true),
    })
}

impl LocalLaunch {
    /// Build the executable + argv for this launch.
    pub fn invocation(&self) -> Result<Invocation, String> {
        let exe = self.shell.resolve_exe()?;
        let extra = match &self.args {
            Some(a) => split_args(a)?,
            None => Vec::new(),
        };
        let command = self.command.as_ref().map(|c| c.trim().to_string());

        let args = if cfg!(target_os = "windows") {
            self.windows_args(extra, command)
        } else {
            posix_args(&exe, extra, command, self.keep_open)
        };
        Ok(Invocation { exe, args })
    }

    /// Windows argv. Extra args go *before* the command switch so they still apply when a command is
    /// set (`cmd.exe /v:on /k build.bat`, `powershell.exe -NoLogo -NoProfile -Command "…"`).
    ///
    /// Interactive launches boot the console codepage to UTF-8 (65001). ConPTY interprets the
    /// child's bytes — including the OSC window title it synthesizes from `SetConsoleTitleW` — in
    /// the console output codepage, and the renderer decodes everything as UTF-8. On a Vietnamese
    /// (or any non-UTF-8) system the default codepage made window titles mojibake in the tab strip
    /// while the pane content stayed fine; `chcp 65001` is what Windows Terminal profiles use for
    /// the same reason. ` >nul`/` >$null` swallows chcp's "Active code page" line.
    fn windows_args(&self, extra: Vec<String>, command: Option<String>) -> Vec<String> {
        match self.shell {
            LocalShell::Cmd => {
                let mut args = extra;
                if let Some(cmd) = command {
                    args.push(if self.keep_open { "/k" } else { "/c" }.to_string());
                    // No `chcp` bootstrap here: it would have to chain into this same `/k` string
                    // with `&&`, and cmd re-parses the command inside the string — a path with
                    // spaces (a workspace `.bat` run) gets split and "is not recognized". The bare
                    // command relies on the spawner quoting the argv entry exactly once.
                    args.push(cmd);
                } else if !args
                    .iter()
                    .any(|a| a.eq_ignore_ascii_case("/k") || a.eq_ignore_ascii_case("/c"))
                {
                    // No saved command and no user-supplied command switch to chain into: cmd.exe
                    // honours only the last `/k`, so a second one would break a quoted path in
                    // extra args. A bare `/k` keeps the shell open after the bootstrap.
                    args.push("/k".to_string());
                    args.push("chcp 65001 >nul".to_string());
                }
                args
            }
            // `default` resolves to the PowerShell executable, so it takes the PowerShell flags too.
            LocalShell::Powershell | LocalShell::Default => {
                let mut args = vec!["-NoLogo".to_string()];
                args.extend(extra);
                if let Some(cmd) = command {
                    if self.keep_open {
                        args.push("-NoExit".to_string());
                    }
                    args.push("-Command".to_string());
                    // `.ps1` runs arrive as `& '<path>'`, and PowerShell parses the whole string as
                    // one script, so a `;`-separated bootstrap is safe to prepend — unlike cmd's
                    // `/k`, PowerShell keeps a quoted path intact after the statement separator.
                    args.push(format!("chcp 65001 >$null; {cmd}"));
                } else {
                    // `-NoExit` keeps the session interactive after the bootstrap runs, so the
                    // codepage is in place before the first prompt paints its window title.
                    args.push("-NoExit".to_string());
                    args.push("-Command".to_string());
                    args.push("chcp 65001 >$null".to_string());
                }
                args
            }
            // `wsl.exe` has no command switch of its own: everything after `--` is run inside the
            // distro, so a command has to be handed to a shell there. Falling through to "args
            // verbatim" dropped the command entirely — a saved WSL connection with a command, and
            // every `.sh` run from a workspace, opened an idle interactive shell instead.
            LocalShell::Wsl => {
                let mut args = extra;
                if let Some(cmd) = command {
                    args.push("--".to_string());
                    args.push("bash".to_string());
                    args.push("-lc".to_string());
                    args.push(if self.keep_open {
                        format!("{cmd}; exec bash -l")
                    } else {
                        cmd
                    });
                }
                args
            }
            _ => extra,
        }
    }
}

/// POSIX argv. A login shell always (`-l`); a command runs via `-c`, re-`exec`ing the login shell
/// afterward when the pane should stay open.
fn posix_args(
    exe: &str,
    extra: Vec<String>,
    command: Option<String>,
    keep_open: bool,
) -> Vec<String> {
    let mut args = extra;
    args.push("-l".to_string());
    if let Some(cmd) = command {
        let body = if keep_open {
            format!("{cmd}; exec {} -l", shell_quote(exe))
        } else {
            cmd
        };
        args.push("-c".to_string());
        args.push(body);
    }
    args
}

#[cfg(test)]
#[path = "launch_tests.rs"]
mod tests;
