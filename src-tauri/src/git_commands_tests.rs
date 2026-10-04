#[cfg(test)]
mod tests {
    use crate::git_commands::*;

    #[tokio::test]
    async fn test_git_status_command() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let result = git_status(manifest_dir.to_string()).await;
        assert!(result.is_ok(), "git_status failed: {:?}", result.err());
        let status = result.unwrap();
        assert!(!status.repo_root.is_empty());
    }

    #[tokio::test]
    async fn test_git_log_command() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let result = git_log(manifest_dir.to_string(), Some(5)).await;
        assert!(result.is_ok(), "git_log failed: {:?}", result.err());
        let log = result.unwrap();
        assert!(!log.is_empty());
    }

    #[tokio::test]
    async fn test_git_diff_nonexistent() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let result = git_diff(
            manifest_dir.to_string(),
            "nonexistent_file_xyz.txt".to_string(),
            false,
        )
        .await;
        assert!(result.is_ok());
        let diff = result.unwrap();
        assert!(diff.hunks.is_empty());
    }

    #[tokio::test]
    async fn test_git_file_history_command() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let result = git_file_history(
            manifest_dir.to_string(),
            "src-tauri/Cargo.toml".to_string(),
            None,
            None,
            Some(3),
        )
        .await;
        let history = result.expect("history of a tracked file");
        assert!(history.len() <= 3);

        let traversal = git_file_history(
            manifest_dir.to_string(),
            "../outside.txt".to_string(),
            Some(1),
            Some(2),
            None,
        )
        .await;
        assert!(traversal.is_err());
    }
}
