// The flow tests and their temporary-repository helper live in sibling files, registered here so
// the crate root stays within its size limit.
#[path = "git_commands_flow_tests.rs"]
mod flow;
#[path = "git_commands_remote_tests.rs"]
mod remote;
#[path = "git_commands_fixture_tests.rs"]
pub(crate) mod repo;

#[cfg(test)]
mod tests {
    use crate::git_commands::*;
    use crate::test_support;
    use tauri::async_runtime::block_on;

    /// A git task that panics on the blocking pool comes back as an error for the UI to show,
    /// instead of tearing down the IPC call.
    #[test]
    fn a_panicking_blocking_task_is_reported_as_an_error() {
        let result: Result<(), String> =
            block_on(crate::git_branch_commands::on_blocking_pool(|| {
                panic!("git task blew up")
            }));
        let error = result.expect_err("the panic surfaces as an error");
        assert!(error.starts_with("Task failed:"), "{error}");
    }

    // Every test below spawns `git`, so each holds the process-wide test lock: other tests in this
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
        let result = block_on(git_log(manifest_dir.to_string(), Some(5), None));
        assert!(result.is_ok(), "git_log failed: {:?}", result.err());
        let log = result.unwrap();
        assert!(!log.is_empty());
        let all_res = block_on(git_log(manifest_dir.to_string(), Some(5), Some("--all".into())));
        assert!(all_res.is_ok());
        let head_res = block_on(git_log(manifest_dir.to_string(), Some(5), Some("HEAD".into())));
        assert!(head_res.is_ok());
    }

    #[test]
    fn test_git_commit_details_command() {
        let _guard = test_support::lock();
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let log = block_on(git_log(manifest_dir.to_string(), Some(1), None)).expect("log");
        assert!(!log.is_empty());
        let details = block_on(git_commit_details(
            manifest_dir.to_string(),
            log[0].id.clone(),
        ));
        assert!(
            details.is_ok(),
            "git_commit_details failed: {:?}",
            details.err()
        );
        let err_details = block_on(git_commit_details(
            manifest_dir.to_string(),
            "--invalid".into(),
        ));
        assert!(err_details.is_err());
    }

    #[test]
    fn test_git_commit_file_diff_command() {
        let _guard = test_support::lock();
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let log = block_on(git_log(manifest_dir.to_string(), Some(1), None)).expect("log");
        assert!(!log.is_empty());
        let diff = block_on(git_commit_file_diff(
            manifest_dir.to_string(),
            log[0].id.clone(),
            "Cargo.toml".to_string(),
            None,
        ));
        assert!(
            diff.is_ok(),
            "git_commit_file_diff failed: {:?}",
            diff.err()
        );
        let diff_old = block_on(git_commit_file_diff(
            manifest_dir.to_string(),
            log[0].id.clone(),
            "Cargo.toml".to_string(),
            Some("Cargo.toml".to_string()),
        ));
        assert!(diff_old.is_ok());
        let err_diff = block_on(git_commit_file_diff(
            manifest_dir.to_string(),
            "--invalid".into(),
            "Cargo.toml".to_string(),
            None,
        ));
        assert!(err_diff.is_err());
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
