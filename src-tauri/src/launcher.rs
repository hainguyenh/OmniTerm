//! Cooperative launcher shims.
//!
//! Ports `ensureHelper` from electron/services/launcher.ts. A small `nc-open.cmd` in
//! `<appData>/bin` — a directory prepended to every local pane's PATH (see `pty::path_with_helper`) —
//! re-invokes this exe with `--open-shell`, so a script running inside a pane opens another pane in
//! this app instead of a detached console window.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(test)]
#[path = "launcher_tests.rs"]
mod tests;

pub fn launcher_bin_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path().app_data_dir().unwrap_or_default().join("bin")
}

/// Batch contents for `nc-open.cmd`. `%*` forwards every argument the caller passed, so
/// `nc-open powershell --cwd C:\x` becomes `<exe> --open-shell powershell --cwd C:\x`.
///
/// `exe` is the absolute path to the running executable. The first port hard-coded
/// `"%~dp0..\..\OmniTerm.exe"` — two levels above `<appData>/bin`, which is somewhere in the user's
/// AppData tree and never where the app is installed, so the shim could not work at all.
pub fn nc_open_contents(exe: &Path) -> String {
    format!("@echo off\r\n\"{}\" --open-shell %*\r\n", exe.display())
}

/// `wt.cmd` shadows Windows Terminal on the pane's PATH and delegates argument parsing to the
/// PowerShell shim beside it.
pub fn wt_cmd_contents() -> String {
    "@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0wt-shim.ps1\" %*\r\n"
        .to_string()
}

/// Windows Terminal shim. Recognizes the common `wt [-w N] new-tab [-d DIR] [--title T] <shell>`
/// shape and routes it to `nc-open`; anything it cannot confidently map falls through to the real
/// `wt.exe`, so behavior is never silently broken.
pub fn wt_shim_contents() -> String {
    r#"$ErrorActionPreference = 'Stop'
$a = $args

function Invoke-RealWt {
  foreach ($d in ($env:PATH -split ';')) {
    if (-not $d) { continue }
    $p = Join-Path $d 'wt.exe'
    if (Test-Path -LiteralPath $p) { & $p @a; return }
  }
  Write-Error 'wt.exe not found on PATH'
}

try {
  if (($a -contains 'split-pane') -or ($a -contains 'sp') -or ($a -contains ';')) { Invoke-RealWt; exit }

  $nt = -1
  for ($i = 0; $i -lt $a.Count; $i++) {
    if (($a[$i] -eq 'new-tab') -or ($a[$i] -eq 'nt')) { $nt = $i; break }
  }
  if ($nt -lt 0) { Invoke-RealWt; exit }

  $dir = $null; $title = $null; $shell = $null; $keep = $null; $cmd = $null
  $i = $nt + 1
  while ($i -lt $a.Count) {
    switch -Regex ($a[$i]) {
      '^(-d|--startingDirectory)$'   { $dir = $a[$i + 1]; $i += 2; continue }
      '^(--title)$'                 { $title = $a[$i + 1]; $i += 2; continue }
      '^(-NoExit)$'                 { $keep = '1'; $i += 1; continue }
      '^(-File|-Command|/k|/c)$'     { $cmd = $a[$i + 1]; $i += 2; continue }
      '^(pwsh|powershell)(\.exe)?$' { $shell = 'powershell'; $i += 1; continue }
      '^(cmd)(\.exe)?$'             { $shell = 'cmd'; $i += 1; continue }
      '^(wsl|bash)(\.exe)?$'        { $shell = 'wsl'; $i += 1; continue }
      default                       { $i += 1 }
    }
  }
  if (-not $shell) { Invoke-RealWt; exit }

  $ncArgs = @($shell)
  if ($dir)   { $ncArgs += @('--cwd', $dir) }
  if ($title) { $ncArgs += @('--name', $title) }
  if ($cmd)   { $ncArgs += @('--command', $cmd) }
  if ($keep)  { $ncArgs += @('--keep-open', '1') }
  & (Join-Path $PSScriptRoot 'nc-open.cmd') @ncArgs
} catch {
  Invoke-RealWt
}
"#
    .to_string()
}

/// Write a shim only when its contents differ, so an unchanged shim keeps its timestamp.
fn write_if_changed(target: &Path, contents: &str) -> Result<(), String> {
    if fs::read_to_string(target)
        .map(|c| c == contents)
        .unwrap_or(false)
    {
        return Ok(());
    }
    fs::write(target, contents).map_err(|e| e.to_string())
}

/// Idempotently write the shims and return the directory to prepend to a pane's PATH.
#[tauri::command]
pub async fn setup_launcher<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let bin_dir = launcher_bin_dir(&app);
    fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    write_if_changed(&bin_dir.join("nc-open.cmd"), &nc_open_contents(&exe))?;
    write_if_changed(&bin_dir.join("wt.cmd"), &wt_cmd_contents())?;
    write_if_changed(&bin_dir.join("wt-shim.ps1"), &wt_shim_contents())?;

    Ok(bin_dir.to_string_lossy().into_owned())
}
