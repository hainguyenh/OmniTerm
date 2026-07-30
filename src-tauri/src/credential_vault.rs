//! Plugin-scoped Windows Credential Manager access.
//!
//! Only the sidecar reverse-RPC policy calls this module, and only for a plugin that declared the
//! `credentials` permission. Secrets never enter a Tauri command response or the webview.

fn target(plugin_id: &str, key: &str) -> Result<String, String> {
    let valid = |value: &str| {
        !value.is_empty()
            && value.len() <= 240
            && !value.chars().any(|c| c.is_control() || matches!(c, '\\' | '/'))
    };
    if !valid(plugin_id) || !valid(key) {
        return Err("invalid credential namespace".to_string());
    }
    Ok(format!("OmniTerm/{plugin_id}/{key}"))
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub fn is_available() -> bool {
    true
}

#[cfg(not(windows))]
pub fn is_available() -> bool {
    false
}

#[cfg(windows)]
pub fn set(plugin_id: &str, key: &str, secret: &str) -> Result<(), String> {
    use windows::core::PWSTR;
    use windows::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let mut target = wide(&target(plugin_id, key)?);
    let mut username = wide(plugin_id);
    let bytes = secret.as_bytes();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        CredentialBlobSize: u32::try_from(bytes.len()).map_err(|_| "credential is too large")?,
        CredentialBlob: bytes.as_ptr().cast_mut(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(username.as_mut_ptr()),
        ..Default::default()
    };
    unsafe { CredWriteW(&credential, 0) }.map_err(|e| format!("Credential Manager write failed: {e}"))
}

#[cfg(not(windows))]
pub fn set(_plugin_id: &str, _key: &str, _secret: &str) -> Result<(), String> {
    Err("Windows Credential Manager is unavailable on this platform".to_string())
}

#[cfg(windows)]
pub fn get(plugin_id: &str, key: &str) -> Result<Option<String>, String> {
    use std::slice;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let target = wide(&target(plugin_id, key)?);
    let mut raw: *mut CREDENTIALW = std::ptr::null_mut();
    let result = unsafe { CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, 0, &mut raw) };
    if let Err(error) = result {
        if error.code().0 as u32 == ERROR_NOT_FOUND.0 {
            return Ok(None);
        }
        return Err(format!("Credential Manager read failed: {error}"));
    }
    if raw.is_null() {
        return Ok(None);
    }
    let value = unsafe {
        let credential = &*raw;
        let bytes = slice::from_raw_parts(
            credential.CredentialBlob,
            credential.CredentialBlobSize as usize,
        );
        String::from_utf8(bytes.to_vec()).map_err(|_| "stored credential is not UTF-8")
    };
    unsafe { CredFree(raw.cast()) };
    value.map(Some).map_err(str::to_string)
}

#[cfg(not(windows))]
pub fn get(_plugin_id: &str, _key: &str) -> Result<Option<String>, String> {
    Err("Windows Credential Manager is unavailable on this platform".to_string())
}

#[cfg(windows)]
pub fn delete(plugin_id: &str, key: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let target = wide(&target(plugin_id, key)?);
    match unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, 0) } {
        Ok(()) => Ok(()),
        Err(error) if error.code().0 as u32 == ERROR_NOT_FOUND.0 => Ok(()),
        Err(error) => Err(format!("Credential Manager delete failed: {error}")),
    }
}

#[cfg(not(windows))]
pub fn delete(_plugin_id: &str, _key: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn prompt_and_set(
    plugin_id: &str,
    key: &str,
    suggested_username: &str,
) -> Result<bool, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_CANCELLED, ERROR_SUCCESS};
    use windows::Win32::Security::Credentials::{
        CredUIPromptForCredentialsW, CREDUI_FLAGS_ALWAYS_SHOW_UI, CREDUI_FLAGS_DO_NOT_PERSIST,
        CREDUI_FLAGS_EXCLUDE_CERTIFICATES, CREDUI_FLAGS_GENERIC_CREDENTIALS,
    };
    use zeroize::Zeroizing;

    let prompt_target = wide(&format!("OmniTerm connection {key}"));
    let mut username = wide(suggested_username);
    username.resize(514, 0);
    let mut password = vec![0u16; 514];
    let flags = CREDUI_FLAGS_ALWAYS_SHOW_UI
        | CREDUI_FLAGS_DO_NOT_PERSIST
        | CREDUI_FLAGS_EXCLUDE_CERTIFICATES
        | CREDUI_FLAGS_GENERIC_CREDENTIALS;
    let result = unsafe {
        CredUIPromptForCredentialsW(
            None,
            PCWSTR(prompt_target.as_ptr()),
            None,
            0,
            &mut username,
            &mut password,
            None,
            flags,
        )
    };
    if result == ERROR_CANCELLED {
        password.fill(0);
        return Ok(false);
    }
    if result != ERROR_SUCCESS {
        password.fill(0);
        return Err(format!("Windows credential prompt failed: {}", result.0));
    }
    let length = password.iter().position(|value| *value == 0).unwrap_or(password.len());
    let secret = Zeroizing::new(
        String::from_utf16(&password[..length])
            .map_err(|_| "Windows returned an invalid credential".to_string())?,
    );
    password.fill(0);
    set(plugin_id, key, &secret)?;
    Ok(true)
}

#[cfg(not(windows))]
pub fn prompt_and_set(_: &str, _: &str, _: &str) -> Result<bool, String> {
    Err("Windows Credential Manager is unavailable on this platform".to_string())
}
