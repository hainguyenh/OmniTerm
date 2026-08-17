// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn state_dir_arg(args: &[String]) -> Result<std::path::PathBuf, String> {
    let index = args
        .iter()
        .position(|arg| arg == "--state-dir")
        .ok_or_else(|| "--sessiond requires --state-dir <path>".to_string())?;
    args.get(index + 1)
        .filter(|value| !value.starts_with("--"))
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "--sessiond requires --state-dir <path>".to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--sessiond") {
        let result = state_dir_arg(&args).and_then(session_core::run_daemon);
        if result.is_err() {
            std::process::exit(2);
        }
        return;
    }
    app_lib::run();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daemon_mode_requires_state_dir_value() {
        assert!(state_dir_arg(&["omniterm".into(), "--sessiond".into()]).is_err());
        assert_eq!(
            state_dir_arg(&[
                "omniterm".into(),
                "--sessiond".into(),
                "--state-dir".into(),
                "state".into(),
            ])
            .unwrap(),
            std::path::PathBuf::from("state")
        );
    }
}
