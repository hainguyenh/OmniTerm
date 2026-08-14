use std::{path::Path, sync::Arc};

use crate::rdp_launch;

pub(crate) struct ExternalLauncherState {
    launcher: Arc<dyn ExternalLauncher>,
}

impl ExternalLauncherState {
    pub(crate) fn system() -> Self {
        Self {
            launcher: Arc::new(SystemExternalLauncher),
        }
    }

    #[cfg(test)]
    pub(crate) fn test() -> Self {
        Self {
            launcher: Arc::new(TestExternalLauncher),
        }
    }

    pub(crate) fn launch_rdp(&self, path: &str) -> Result<(), String> {
        self.launcher.launch_rdp(path)
    }

    pub(crate) fn open_folder(&self, path: &Path) -> Result<(), String> {
        self.launcher.open_folder(path)
    }
}

trait ExternalLauncher: Send + Sync {
    fn launch_rdp(&self, path: &str) -> Result<(), String>;
    fn open_folder(&self, path: &Path) -> Result<(), String>;
}

struct SystemExternalLauncher;

impl ExternalLauncher for SystemExternalLauncher {
    fn launch_rdp(&self, path: &str) -> Result<(), String> {
        rdp_launch::launch_rdp(path)
    }

    fn open_folder(&self, path: &Path) -> Result<(), String> {
        if opener::open(path).is_err() {
            #[cfg(target_os = "windows")]
            std::process::Command::new("explorer")
                .arg(path)
                .spawn()
                .map_err(|spawn_error| spawn_error.to_string())?;

            #[cfg(target_os = "macos")]
            std::process::Command::new("open")
                .arg(path)
                .spawn()
                .map_err(|spawn_error| spawn_error.to_string())?;

            #[cfg(target_os = "linux")]
            std::process::Command::new("xdg-open")
                .arg(path)
                .spawn()
                .map_err(|spawn_error| spawn_error.to_string())?;

        }

        Ok(())
    }
}

#[cfg(test)]
struct TestExternalLauncher;

#[cfg(test)]
impl ExternalLauncher for TestExternalLauncher {
    fn launch_rdp(&self, path: &str) -> Result<(), String> {
        rdp_launch::rdp_command(path, std::env::consts::OS).map(|_| ())
    }

    fn open_folder(&self, _path: &Path) -> Result<(), String> {
        Ok(())
    }
}
