//! Native plugin package installation/removal.
//!
//! The webview never supplies a filesystem path. A native picker selects a ZIP, Rust validates its
//! manifest and archive paths, and a second native dialog names the plugin and requested permissions
//! before any executable code is copied into the discovery directory. Plugins load only after an app
//! restart, so an installed archive is never `require`d as a side effect of a renderer call.

use crate::plugin_host::PluginHost;
use rfd::{AsyncFileDialog, AsyncMessageDialog, MessageButtons, MessageDialogResult, MessageLevel};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime, State};
use uuid::Uuid;

const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 2_000;
const KNOWN_PERMISSIONS: [&str; 6] = [
    "connections",
    "auth",
    "renderer",
    "openExternal",
    "clipboard",
    "workspace",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginChange {
    installed: bool,
    id: String,
    name: String,
    version: String,
    restart_required: bool,
}

#[derive(Debug)]
struct PackageManifest {
    id: String,
    name: String,
    version: String,
    main: String,
    permissions: Vec<String>,
}

fn safe_dir_name(id: &str) -> String {
    id.chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | '?' | '%' | '*' | ':' | '|' | '"' | '<' | '>') {
                '_'
            } else {
                c
            }
        })
        .collect()
}

fn checked_dir_name(id: &str) -> Result<String, String> {
    let safe = safe_dir_name(id);
    if safe.is_empty()
        || matches!(safe.as_str(), "." | "..")
        || id.chars().any(|value| value.is_control())
    {
        return Err("Plugin package name is unsafe.".to_string());
    }
    Ok(safe)
}

fn parse_manifest(bytes: &[u8]) -> Result<PackageManifest, String> {
    let pkg: Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("package.json is not valid JSON: {error}"))?;
    let plugin = pkg
        .get("omnitermPlugin")
        .and_then(Value::as_object)
        .ok_or("This ZIP is not an OmniTerm plugin package.")?;
    let id = pkg
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 200)
        .ok_or("Plugin package.json has no valid name.")?
        .to_string();
    checked_dir_name(&id)?;
    let api_version = plugin
        .get("apiVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    if api_version != 2 {
        return Err(format!(
            "Plugin API version {api_version} is incompatible; OmniTerm requires version 2."
        ));
    }
    let permission_values = plugin
        .get("permissions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if permission_values.iter().any(|value| !value.is_string()) {
        return Err("Plugin permissions must be strings.".to_string());
    }
    let permissions: Vec<String> = permission_values
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    if let Some(unknown) = permissions
        .iter()
        .find(|permission| !KNOWN_PERMISSIONS.contains(&permission.as_str()))
    {
        return Err(format!("Plugin requests unknown permission \"{unknown}\"."));
    }
    let main = pkg
        .get("main")
        .and_then(Value::as_str)
        .unwrap_or("dist/index.js")
        .replace('\\', "/");
    let main_path = Path::new(&main);
    if main_path.has_root()
        || main_path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("Plugin main path is unsafe.".to_string());
    }
    Ok(PackageManifest {
        id,
        name: plugin
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or("Unnamed plugin")
            .to_string(),
        version: pkg
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("0.0.0")
            .to_string(),
        main,
        permissions,
    })
}

fn read_package_manifest(archive: &mut zip::ZipArchive<fs::File>) -> Result<PackageManifest, String> {
    if archive.len() > MAX_FILES {
        return Err(format!("Plugin ZIP contains too many files (max {MAX_FILES})."));
    }
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let size = archive
            .by_index(index)
            .map_err(|error| format!("Could not inspect plugin ZIP: {error}"))?
            .size();
        total = total
            .checked_add(size)
            .ok_or("Plugin ZIP size metadata overflowed.")?;
        if total > MAX_ARCHIVE_BYTES {
            return Err("Plugin ZIP is too large after extraction (max 64 MB).".to_string());
        }
    }
    let mut package = archive
        .by_name("package.json")
        .map_err(|_| "Plugin ZIP must contain package.json at its root.".to_string())?;
    if package.size() > 1024 * 1024 {
        return Err("Plugin package.json is too large.".to_string());
    }
    let mut bytes = Vec::new();
    package
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read package.json: {error}"))?;
    parse_manifest(&bytes)
}

fn extract_validated(
    archive: &mut zip::ZipArchive<fs::File>,
    destination: &Path,
) -> Result<(), String> {
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read plugin ZIP: {error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or("Plugin ZIP contains an unsafe path.")?
            .to_path_buf();
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|error| error.to_string())?;
            continue;
        }
        if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err("Plugin ZIP may not contain symbolic links.".to_string());
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut file = fs::File::create(&output).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn installed_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("plugins"))
}

#[tauri::command]
pub async fn install_plugin_package<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, PluginHost>,
) -> Result<Option<PluginChange>, String> {
    let Some(file) = AsyncFileDialog::new()
        .add_filter("OmniTerm plugin package", &["zip"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let archive_file = fs::File::open(file.path()).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(archive_file).map_err(|error| format!("Invalid plugin ZIP: {error}"))?;
    let manifest = read_package_manifest(&mut archive)?;
    let permissions = if manifest.permissions.is_empty() {
        "none".to_string()
    } else {
        manifest.permissions.join(", ")
    };
    let approved = AsyncMessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title("Install OmniTerm plugin?")
        .set_description(format!(
            "{} {} ({})\n\nPermissions: {}\n\nPlugins run as your user and can access your files and network. Install only packages you trust.",
            manifest.name, manifest.version, manifest.id, permissions
        ))
        .set_buttons(MessageButtons::YesNo)
        .show()
        .await;
    if approved != MessageDialogResult::Yes {
        return Ok(None);
    }

    let restart_required = !host.list_plugins().await.unwrap_or_default().is_empty();
    let plugins = installed_dir(&app)?;
    fs::create_dir_all(&plugins).map_err(|error| error.to_string())?;
    let staging = plugins.join(format!(".install-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let result = (|| {
        extract_validated(&mut archive, &staging)?;
        if !staging.join(&manifest.main).is_file() {
            return Err(format!(
                "Plugin entry point \"{}\" is missing from the ZIP.",
                manifest.main
            ));
        }
        let target = plugins.join(checked_dir_name(&manifest.id)?);
        let backup = plugins.join(format!(".replace-{}", Uuid::new_v4()));
        if target.exists() {
            fs::rename(&target, &backup)
                .map_err(|error| format!("Could not replace the installed plugin: {error}"))?;
        }
        if let Err(error) = fs::rename(&staging, &target) {
            if backup.exists() {
                let _ = fs::rename(&backup, &target);
            }
            return Err(format!("Could not install the plugin: {error}"));
        }
        if backup.exists() {
            fs::remove_dir_all(&backup).map_err(|error| error.to_string())?;
        }
        Ok(())
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result?;
    Ok(Some(PluginChange {
        installed: true,
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        restart_required,
    }))
}

#[tauri::command]
pub async fn remove_plugin<R: Runtime>(
    app: AppHandle<R>,
    host: State<'_, PluginHost>,
    id: String,
) -> Result<bool, String> {
    let target = installed_dir(&app)?.join(checked_dir_name(&id)?);
    let package = target.join("package.json");
    if !package.is_file() {
        return Err("Only user-installed plugins can be removed.".to_string());
    }
    let manifest = parse_manifest(&fs::read(&package).map_err(|error| error.to_string())?)?;
    if manifest.id != id {
        return Err("Installed plugin identity does not match its directory.".to_string());
    }
    // If the sidecar is running, remove even an incompatible/disabled descriptor from its registry.
    // A plugin-free Basic build has no sidecar, in which case deleting the validated files is enough.
    let _ = host.uninstall(id).await;
    fs::remove_dir_all(target).map_err(|error| format!("Could not remove plugin files: {error}"))?;
    Ok(true)
}

#[tauri::command]
pub fn restart_app<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

#[cfg(test)]
#[path = "plugin_management_tests.rs"]
mod tests;
