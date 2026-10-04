#[cfg(test)]
mod tests {
    use crate::git::{
        find_repo_root, get_commit_log, get_file_diff, get_repo_status, parse_unified_diff,
    };
    use app_protocol::git::GitDiffLineType;
    use std::path::Path;

    #[test]
    fn test_parse_unified_diff_simple() {
        let diff_text = r#"@@ -1,3 +1,4 @@
 common line 1
-deleted line
+added line 1
+added line 2
 common line 2
"#;
        let diff = parse_unified_diff("test.txt", diff_text);
        assert_eq!(diff.path, "test.txt");
        assert!(!diff.is_binary);
        assert_eq!(diff.hunks.len(), 1);

        let hunk = &diff.hunks[0];
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.old_lines, 3);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.new_lines, 4);

        let lines = &hunk.lines;
        assert_eq!(lines.len(), 5);
        assert_eq!(lines[0].line_type, GitDiffLineType::Context);
        assert_eq!(lines[0].old_lineno, Some(1));
        assert_eq!(lines[0].new_lineno, Some(1));

        assert_eq!(lines[1].line_type, GitDiffLineType::Deletion);
        assert_eq!(lines[1].old_lineno, Some(2));
        assert_eq!(lines[1].new_lineno, None);

        assert_eq!(lines[2].line_type, GitDiffLineType::Addition);
        assert_eq!(lines[2].old_lineno, None);
        assert_eq!(lines[2].new_lineno, Some(2));

        assert_eq!(lines[3].line_type, GitDiffLineType::Addition);
        assert_eq!(lines[3].old_lineno, None);
        assert_eq!(lines[3].new_lineno, Some(3));
    }

    #[test]
    fn test_parse_unified_diff_binary() {
        let diff_text = "Binary files a/img.png and b/img.png differ\n";
        let diff = parse_unified_diff("img.png", diff_text);
        assert!(diff.is_binary);
        assert!(diff.hunks.is_empty());
    }

    #[test]
    fn test_find_repo_root_and_status() {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = find_repo_root(manifest_dir);
        assert!(
            root.is_ok(),
            "Expected to find git repo root from CARGO_MANIFEST_DIR"
        );
        let root_path = root.unwrap();
        assert!(root_path.exists());

        let status = get_repo_status(&root_path);
        assert!(
            status.is_ok(),
            "Expected get_repo_status to succeed in repo: {:?}",
            status.err()
        );
        let st = status.unwrap();
        assert!(st.branch.is_some() || st.is_detached);
    }

    #[test]
    fn test_get_commit_log() {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = find_repo_root(manifest_dir).expect("repo root exists");
        let log = get_commit_log(&root, 5);
        assert!(log.is_ok(), "Expected git log to succeed");
        let entries = log.unwrap();
        assert!(!entries.is_empty(), "Expected at least 1 commit in log");
        assert!(!entries[0].id.is_empty());
        assert!(!entries[0].short_id.is_empty());
    }

    #[test]
    fn test_get_file_diff_existing() {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = find_repo_root(manifest_dir).expect("repo root exists");
        let diff = get_file_diff(&root, "Cargo.toml", false);
        assert!(
            diff.is_ok(),
            "Expected get_file_diff to succeed: {:?}",
            diff.err()
        );
    }

    #[test]
    fn test_resolve_git_binary() {
        let binary = crate::git::resolve_git_binary();
        assert!(!binary.as_os_str().is_empty());
    }

    #[test]
    fn test_strip_ansi_codes() {
        let colored = "\x1b[32m+added line\x1b[0m\n\x1b[31m-deleted line\x1b[m";
        let cleaned = crate::git::strip_ansi_codes(colored);
        assert_eq!(cleaned, "+added line\n-deleted line");
    }

    #[test]
    fn test_find_repo_root_nonexistent() {
        let fake_path = Path::new("D:/nonexistent_folder_xyz_12345");
        let root = find_repo_root(fake_path);
        assert!(root.is_err());
    }

    #[test]
    fn test_porcelain_v2_parsing_exact_paths() {
        use crate::git::parse_porcelain_v2;
        let simulated_stdout = b"# branch.oid abcdef123456\0\
# branch.head feature/test-branch\0\
# branch.upstream origin/feature/test-branch\0\
# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 01212e7791e1e18454838ed013d4a63d1d76db41 01212e7791e1e18454838ed013d4a63d1d76db41 apps/server/src/jobs/route.test.ts\0\
1 M. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 path with spaces/my file.rs\0\
2 R. N... 100644 100644 100644 3333333333333333333333333333333333333333 4444444444444444444444444444444444444444 R100 new/renamed_file.txt\0old/orig_file.txt\0\
u UU N... 100644 100644 100644 100644 5555 6666 7777 conflict/test.ts\0\
? untracked_file.rs\0";

        let st = parse_porcelain_v2(simulated_stdout, "/mock/repo");
        assert_eq!(st.branch.as_deref(), Some("feature/test-branch"));
        assert_eq!(st.upstream.as_deref(), Some("origin/feature/test-branch"));
        assert_eq!(st.ahead, 2);
        assert_eq!(st.behind, 1);
        assert_eq!(st.files.len(), 5);

        // Entry 1: Type 1 ordinary modified
        assert_eq!(st.files[0].path, "apps/server/src/jobs/route.test.ts");
        assert_eq!(st.files[0].staged, app_protocol::git::GitFileStatus::Unmodified);
        assert_eq!(st.files[0].unstaged, app_protocol::git::GitFileStatus::Modified);

        // Entry 2: Type 1 with space in path
        assert_eq!(st.files[1].path, "path with spaces/my file.rs");
        assert_eq!(st.files[1].staged, app_protocol::git::GitFileStatus::Modified);
        assert_eq!(st.files[1].unstaged, app_protocol::git::GitFileStatus::Unmodified);

        // Entry 3: Type 2 renamed
        assert_eq!(st.files[2].path, "new/renamed_file.txt");
        assert_eq!(st.files[2].orig_path.as_deref(), Some("old/orig_file.txt"));
        assert_eq!(st.files[2].staged, app_protocol::git::GitFileStatus::Renamed);

        // Entry 4: Conflicted
        assert_eq!(st.files[3].path, "conflict/test.ts");
        assert!(st.files[3].is_conflicted);
        assert_eq!(st.conflict_count, 1);

        // Entry 5: Untracked
        assert_eq!(st.files[4].path, "untracked_file.rs");
        assert_eq!(st.files[4].unstaged, app_protocol::git::GitFileStatus::Untracked);
    }

    #[test]
    fn test_get_file_diff_path_handling() {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = find_repo_root(manifest_dir).expect("repo root exists");

        // Relative path
        let diff_rel = get_file_diff(&root, "Cargo.toml", false);
        assert!(diff_rel.is_ok());

        // Leading slash / dot-slash path
        let diff_slash = get_file_diff(&root, "./Cargo.toml", false);
        assert!(diff_slash.is_ok());

        // Absolute path
        let abs_path = root.join("Cargo.toml").to_string_lossy().to_string();
        let diff_abs = get_file_diff(&root, &abs_path, false);
        assert!(diff_abs.is_ok());
    }
}
