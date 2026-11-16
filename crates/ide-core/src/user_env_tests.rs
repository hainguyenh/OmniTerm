use std::ffi::OsString;

use super::{merge_path, overlay, parse_block};

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

#[test]
fn a_block_lists_its_variables_without_the_hidden_drive_entries() {
    let block = wide("=C:=C:\\work\0Path=C:\\Windows\0JAVA_HOME=C:\\jdk=21\0\0");
    let vars: Vec<(String, String)> = parse_block(&block)
        .into_iter()
        .map(|(key, value)| (String::from_utf16(key).unwrap(), String::from_utf16(value).unwrap()))
        .collect();
    assert_eq!(
        vars,
        [("Path".to_owned(), "C:\\Windows".to_owned()), ("JAVA_HOME".to_owned(), "C:\\jdk=21".to_owned())]
    );
}

#[test]
fn an_empty_block_has_no_variables() {
    assert!(parse_block(&[0, 0]).is_empty());
}

#[test]
fn the_fresh_path_comes_first_and_keeps_inherited_only_entries() {
    let merged = merge_path("C:\\Windows;C:\\Tools\\new", "C:\\windows\\;C:\\Users\\me\\.nvm;;C:\\Tools\\New");
    assert_eq!(merged, "C:\\Windows;C:\\Tools\\new;C:\\Users\\me\\.nvm");
}

#[test]
fn registry_values_override_the_inherited_ones_and_path_is_merged() {
    let fresh = vec![
        (OsString::from("JAVA_HOME"), OsString::from("C:\\jdk-21")),
        (OsString::from("PATH"), OsString::from("C:\\Windows;C:\\Tools")),
    ];
    let vars = overlay(fresh, |key| {
        assert_eq!(key, "Path");
        Some(OsString::from("C:\\Windows;C:\\from-shell"))
    });
    assert_eq!(
        vars,
        [
            (OsString::from("JAVA_HOME"), OsString::from("C:\\jdk-21")),
            (OsString::from("PATH"), OsString::from("C:\\Windows;C:\\Tools;C:\\from-shell")),
        ]
    );
}

#[test]
fn without_an_inherited_path_the_fresh_one_is_used_as_is() {
    let vars = overlay(vec![(OsString::from("Path"), OsString::from("C:\\Windows"))], |_| None);
    assert_eq!(vars, [(OsString::from("Path"), OsString::from("C:\\Windows"))]);
}

#[cfg(windows)]
#[test]
fn the_current_user_environment_is_read_from_the_registry() {
    let vars = super::refreshed_vars();
    let get = |name: &str| vars.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, v)| v.clone());
    let system_root = get("SystemRoot").expect("the fresh block defines SystemRoot");
    assert_eq!(Some(system_root), std::env::var_os("SystemRoot"));
    let path = get("Path").expect("the fresh block defines Path");
    assert!(path.to_string_lossy().to_ascii_lowercase().contains("system32"), "{path:?}");
}

#[cfg(not(windows))]
#[test]
fn outside_windows_nothing_is_refreshed() {
    assert!(super::refreshed_vars().is_empty());
}

/// Writes a user variable under `HKCU\Environment` and removes it on drop.
#[cfg(windows)]
struct UserVariable {
    key: windows_sys::Win32::System::Registry::HKEY,
    name: Vec<u16>,
}

#[cfg(windows)]
impl UserVariable {
    fn set(name: &str, value: &str) -> Self {
        use windows_sys::Win32::System::Registry::{RegOpenKeyExW, RegSetValueExW, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ};
        let subkey: Vec<u16> = "Environment\0".encode_utf16().collect();
        let name: Vec<u16> = name.encode_utf16().chain([0]).collect();
        let data: Vec<u16> = value.encode_utf16().chain([0]).collect();
        let mut key = std::ptr::null_mut();
        // SAFETY: NUL-terminated strings and a valid out pointer; the key is closed on drop.
        let opened = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_SET_VALUE, &mut key) };
        assert_eq!(opened, 0, "open the user environment key");
        let variable = Self { key, name };
        // SAFETY: `data` is a NUL-terminated UTF-16 string of the given byte length.
        let set = unsafe {
            RegSetValueExW(key, variable.name.as_ptr(), 0, REG_SZ, data.as_ptr().cast(), (data.len() * 2) as u32)
        };
        assert_eq!(set, 0, "write the test variable");
        variable
    }
}

#[cfg(windows)]
impl Drop for UserVariable {
    fn drop(&mut self) {
        use windows_sys::Win32::System::Registry::{RegCloseKey, RegDeleteValueW};
        // SAFETY: `key` is open and `name` NUL-terminated; neither is used afterwards.
        unsafe {
            RegDeleteValueW(self.key, self.name.as_ptr());
            RegCloseKey(self.key);
        }
    }
}

#[cfg(windows)]
#[test]
fn a_user_variable_set_after_start_reaches_new_terminals() {
    let name = format!("OMNITERM_TEST_REFRESH_{}", std::process::id());
    let _variable = UserVariable::set(&name, "fresh");
    assert_eq!(std::env::var_os(&name), None, "the process keeps the environment it started with");
    let vars = super::refreshed_vars();
    let value = vars.iter().find(|(key, _)| key.eq_ignore_ascii_case(&name)).map(|(_, v)| v.clone());
    assert_eq!(value, Some(OsString::from("fresh")));
}
