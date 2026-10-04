// The flow tests and their temporary-repository helper live in sibling files, registered here so
// the crate root stays within its size limit.
#[path = "git_commands_fixture_tests.rs"]
pub(crate) mod repo;
#[path = "git_commands_flow_tests.rs"]
mod flow;
#[path = "git_commands_remote_tests.rs"]
mod remote;

#[cfg(test)]
mod tests {
    use crate::git_commands::*;
    use crate::test_support;
    use tauri::async_runtime::block_on;

    // Every test here spawns `git`, so each holds the process-wide test lock: other tests in this
    // binary point `PATH` at a temporary tool directory, and a `git` spawned meanwhile is not found.

    #[test]
    fn test_git_status_command() {
        let _guard = test_support::lock();
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let result = block_on(git_status(manifest_dir.to_string()));
        assert!(result.is_ok(), "git_status failed: {:?}", result.err());
        let status = result.unwrap();
        assert!(!status.repo_root.is_empty());
    }

    #[test]
    fn test_git_log_command() {
        let _guard = test_support::lock();
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let result = block_on(git_log(manifest_dir.to_string(), Some(5)));
        assert!(result.is_ok(), "git_log failed: {:?}", result.err());
        let log = result.unwrap();
        assert!(!log.is_empty());
    }

    #[test]
    fn test_git_diff_nonexistent() {
        let _guard = test_support::lock();
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let result = block_on(git_diff(
            manifest_dir.to_string(),
            "nonexistent_file_xyz.txt".to_string(),
            false,
        ));
        assert!(result.is_ok());
        let diff = result.unwrap();
        assert!(diff.hunks.is_empty());
    }

    #[test]
    fn test_git_file_history_command() {
        let _guard = test_support::lock();
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let result = block_on(git_file_history(
            manifest_dir.to_string(),
            "src-tauri/Cargo.toml".to_string(),
            None,
            None,
            Some(3),
        ));
        let history = result.expect("history of a tracked file");
        assert!(history.len() <= 3);

        let traversal = block_on(git_file_history(
            manifest_dir.to_string(),
            "../outside.txt".to_string(),
            Some(1),
            Some(2),
            None,
        ));
        assert!(traversal.is_err());
    }
}
