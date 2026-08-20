/// Take out or hand back the Windows sleep request.
///
/// **Thread-affine.** `SetThreadExecutionState` records the request against the calling thread, and
/// only a call on that same thread releases it. Clearing from anywhere else returns success and
/// changes nothing, so the machine stays awake while the caller believes it stopped. Every call must
/// come from the Always Awake poller thread — see `always_awake::spawn_poller`.
#[cfg(windows)]
pub(super) fn apply_assertion(asserted: bool) -> Result<(), String> {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    let flags = if asserted {
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    } else {
        ES_CONTINUOUS
    };
    if unsafe { SetThreadExecutionState(flags).0 } == 0 {
        return Err("Windows rejected the sleep-prevention request.".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn apply_assertion(_asserted: bool) -> Result<(), String> {
    Err("Always Awake is currently supported on Windows only.".to_string())
}

#[cfg(windows)]
pub(super) fn sleep_timeout_seconds() -> Result<Option<u64>, String> {
    use std::os::windows::process::CommandExt;

    // Keep the compatibility fallback, but never let its console window flash over the app.
    let output = std::process::Command::new("powercfg")
        .creation_flags(0x0800_0000)
        .args(["/query", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"])
        .output()
        .map_err(|e| format!("Could not read Windows sleep timeout: {e}"))?;
    if !output.status.success() {
        return Err("Windows did not return the active sleep timeout.".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        if line.contains("Current AC Power Setting Index") {
            let value = line
                .rsplit(':')
                .next()
                .unwrap_or_default()
                .trim()
                .trim_start_matches("0x");
            let seconds = u64::from_str_radix(value, 16)
                .map_err(|_| "Windows returned an invalid sleep timeout.".to_string())?;
            return Ok((seconds > 0).then_some(seconds));
        }
    }
    Err("Windows sleep timeout was not found.".to_string())
}

#[cfg(not(windows))]
pub(super) fn sleep_timeout_seconds() -> Result<Option<u64>, String> {
    Err("Windows sleep timeout is unavailable on this platform.".to_string())
}

#[cfg(windows)]
pub(super) fn idle_seconds() -> Result<u64, String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return Err("Could not read Windows user idle time.".to_string());
    }
    let now = unsafe { windows::Win32::System::SystemInformation::GetTickCount() };
    Ok(now.wrapping_sub(info.dwTime) as u64 / 1000)
}

#[cfg(not(windows))]
pub(super) fn idle_seconds() -> Result<u64, String> {
    Err("Windows user idle time is unavailable on this platform.".to_string())
}

#[cfg(windows)]
pub(super) fn jiggle_mouse() -> Result<(), String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};
    let mut original = POINT::default();
    unsafe {
        GetCursorPos(&mut original).map_err(|e| format!("Could not read mouse position: {e}"))?;
        let moved = POINT {
            x: original.x.saturating_add(1),
            y: original.y,
        };
        SetCursorPos(moved.x, moved.y).map_err(|e| format!("Could not move the mouse: {e}"))?;
        // Restore immediately, but do not overwrite a real user movement observed between calls.
        let mut current = POINT::default();
        GetCursorPos(&mut current).map_err(|e| format!("Could not re-read mouse position: {e}"))?;
        if current.x == moved.x && current.y == moved.y {
            SetCursorPos(original.x, original.y)
                .map_err(|e| format!("Could not restore the mouse position: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn jiggle_mouse() -> Result<(), String> {
    Err("Mouse jiggle is currently supported on Windows only.".to_string())
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn every_shim_reports_itself_unsupported() {
        // The commands surface these strings to the user, so they are part of the contract.
        assert!(apply_assertion(true).is_err());
        assert!(apply_assertion(false).is_err());
        assert!(sleep_timeout_seconds().is_err());
        assert!(idle_seconds().is_err());
        assert!(jiggle_mouse().is_err());
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::jiggle_mouse;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    #[test]
    fn the_sleep_assertion_round_trips() {
        super::apply_assertion(true).expect("Windows should accept sleep prevention");
        super::apply_assertion(false).expect("Windows should clear sleep prevention");
    }

    #[test]
    fn the_idle_time_and_sleep_timeout_are_readable() {
        super::idle_seconds().expect("Windows should report user idle time");
        // A machine configured never to sleep answers `Ok(None)`; both are fine, an Err is not.
        super::sleep_timeout_seconds().expect("Windows should report the active sleep timeout");
    }

    #[test]
    fn jiggle_mouse_succeeds_on_an_interactive_desktop() {
        let mut before = POINT::default();
        if unsafe { GetCursorPos(&mut before) }.is_err() {
            // Non-interactive desktop session (e.g. CI runner or headless service) has no desktop access for GetCursorPos.
            return;
        }
        jiggle_mouse().expect("mouse jiggle should complete");
        // Another process may move the shared cursor after jiggle_mouse returns, so an exact
        // position comparison would make this test race with desktop input rather than test our
        // best-effort restore contract.
    }
}
