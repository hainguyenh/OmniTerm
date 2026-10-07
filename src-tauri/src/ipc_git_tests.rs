//! Every Git command invoked by name through the IPC layer, with the webview's camel-case argument
//! names, against disposable repositories.

use super::IpcApp;
use crate::git_commands_tests::repo::{
    commit_file, configure, cwd, git, head, read, repo_with_commit, write, ScrubbedGitEnv,
};
use serde_json::{json, Value};

fn len(value: &Value) -> usize {
    value.as_array().expect("an array response").len()
}

#[test]
fn ipc_git_working_tree_file_and_branch_commands() {
    let fixture = IpcApp::new();
    let _env = ScrubbedGitEnv::new();
    let (_temp, root) = repo_with_commit();
    let dir = cwd(&root);
    let file = json!({ "cwd": &dir, "filePath": "a.txt" });
    let with = |extra: Value| {
        let mut body = file.clone();
        body.as_object_mut()
            .expect("object body")
            .extend(extra.as_object().expect("object extra").clone());
        body
    };

    assert_eq!(
        fixture.ok("git_status", json!({ "cwd": &dir }))["branch"],
        "main"
    );
    assert_eq!(
        fixture.ok("git_write_file", with(json!({ "content": "a\n" }))),
        Value::Null
    );
    assert_eq!(fixture.ok("git_read_file", file.clone()), "a\n");
    let diff = fixture.ok("git_diff", with(json!({ "staged": false })));
    assert_eq!(diff["hunks"][0]["lines"][0]["content"], "a");

    let paths = json!({ "cwd": &dir, "paths": ["a.txt"] });
    fixture.ok("git_stage", paths.clone());
    assert_eq!(
        fixture.ok("git_status", json!({ "cwd": &dir }))["files"][0]["staged"],
        "added"
    );
    fixture.ok("git_unstage", paths.clone());
    assert_eq!(
        fixture.ok("git_status", json!({ "cwd": &dir }))["files"][0]["unstaged"],
        "untracked"
    );
    fixture.ok("git_stage", paths);
    fixture.ok(
        "git_commit",
        json!({ "cwd": &dir, "message": "add a", "amend": false }),
    );
    let log = fixture.ok("git_log", json!({ "cwd": &dir, "limit": 1 }));
    assert_eq!(len(&log), 1);
    assert_eq!(log[0]["summary"], "add a");
    assert_eq!(
        len(&fixture.ok("git_log", json!({ "cwd": &dir, "limit": null }))),
        2
    );

    let head_sha = log[0]["id"].as_str().expect("head sha");
    let details = fixture.ok(
        "git_commit_details",
        json!({ "cwd": &dir, "commitId": head_sha }),
    );
    assert_eq!(details["commit"]["summary"], "add a");
    assert_eq!(details["files"][0]["path"], "a.txt");

    let file_diff = fixture.ok(
        "git_commit_file_diff",
        json!({ "cwd": &dir, "commitId": head_sha, "filePath": "a.txt", "oldPath": null }),
    );
    assert_eq!(file_diff["path"], "a.txt");

    assert_eq!(
        fixture.ok(
            "git_read_file_revision",
            with(json!({ "revision": "HEAD" }))
        ),
        "a\n"
    );
    let blame = fixture.ok("git_blame", file.clone());
    assert_eq!(blame[0]["content"], "a");
    assert_eq!(blame[0]["line_no"], 1);
    let history = fixture.ok(
        "git_file_history",
        with(json!({ "startLine": 1, "endLine": 1, "limit": null })),
    );
    assert_eq!(history[0]["commit"]["summary"], "add a");
    assert_eq!(history[0]["path"], "a.txt");

    write(&root, "a.txt", "b\n");
    let against_head = fixture.ok("git_diff_branch", with(json!({ "branch": "HEAD" })));
    assert_eq!(against_head["path"], "a.txt");
    assert_eq!(len(&against_head["hunks"]), 1);
    fixture.ok("git_revert", json!({ "cwd": &dir, "paths": ["a.txt"] }));
    assert_eq!(read(&root, "a.txt"), "a\n");

    fixture.ok(
        "git_create_branch",
        json!({ "cwd": &dir, "name": "side", "startPoint": null, "checkout": true }),
    );
    let side_tip = commit_file(&root, "side.txt", "side\n", "side work");
    let comparison = fixture.ok(
        "git_compare_branches",
        json!({ "cwd": &dir, "baseBranch": "main", "targetBranch": "side" }),
    );
    assert_eq!(comparison["commits_ahead"][0]["id"], side_tip.as_str());
    assert_eq!(comparison["files"][0]["path"], "side.txt");
    fixture.ok("git_checkout", json!({ "cwd": &dir, "branch": "main" }));
    fixture.ok("git_merge", json!({ "cwd": &dir, "branch": "side" }));
    assert_eq!(head(&root), side_tip);
    fixture.ok("git_rebase", json!({ "cwd": &dir, "branch": "side" }));

    git(&root, &["checkout", "-q", "-b", "pick"]);
    let picked = commit_file(&root, "pick.txt", "pick\n", "pick work");
    git(&root, &["checkout", "-q", "main"]);
    fixture.ok(
        "git_cherry_pick",
        json!({ "cwd": &dir, "commitId": picked }),
    );
    assert_eq!(read(&root, "pick.txt"), "pick\n");

    let names: Vec<_> = fixture
        .ok("git_branches", json!({ "cwd": &dir }))
        .as_array()
        .expect("branch list")
        .iter()
        .filter_map(|branch| branch["name"].as_str().map(str::to_string))
        .collect();
    assert_eq!(names, vec!["main", "pick", "side"]);
    let deleted = fixture.ok(
        "git_delete_branches",
        json!({ "cwd": &dir, "branches": ["side", "pick"], "force": true }),
    );
    assert_eq!(deleted["deleted"], json!(["side", "pick"]));
    assert_eq!(deleted["failed"], json!([]));

    fixture.ok("git_delete_file", file.clone());
    assert!(!root.join("a.txt").exists());
    assert!(fixture
        .error("git_status", json!({ "cwd": cwd(&root.join("missing")) }))
        .as_str()
        .is_some_and(|error| error.contains("does not exist")));
    // A missing argument is rejected by the generated adapter before the command body runs.
    fixture.error("git_diff", json!({ "cwd": &dir, "filePath": "a.txt" }));
}

#[test]
fn ipc_git_stash_remote_and_init_commands() {
    let fixture = IpcApp::new();
    let _env = ScrubbedGitEnv::new();
    let (_temp, root) = repo_with_commit();
    let dir = cwd(&root);
    let base = root.parent().expect("repo has a parent").to_path_buf();
    let call = |command: &str, extra: Value| {
        let mut body = json!({ "cwd": &dir });
        body.as_object_mut()
            .expect("object body")
            .extend(extra.as_object().expect("object extra").clone());
        fixture.ok(command, body)
    };

    write(&root, "README.md", "stashed\n");
    call(
        "git_stash_save",
        json!({ "message": "wip", "keepIndex": false }),
    );
    assert_eq!(read(&root, "README.md"), "hello\n");
    let list = call("git_stash_list", json!({}));
    assert_eq!(len(&list), 1);
    assert_eq!(list[0]["name"], "stash@{0}");
    call("git_stash_apply", json!({ "index": 0 }));
    assert_eq!(read(&root, "README.md"), "stashed\n");
    call("git_revert", json!({ "paths": ["README.md"] }));
    call("git_stash_pop", json!({ "index": null }));
    assert_eq!(read(&root, "README.md"), "stashed\n");
    assert_eq!(len(&call("git_stash_list", json!({}))), 0);
    call(
        "git_stash_save",
        json!({ "message": null, "keepIndex": true }),
    );
    call("git_stash_drop", json!({ "index": 0 }));
    assert_eq!(len(&call("git_stash_list", json!({}))), 0);
    assert_eq!(read(&root, "README.md"), "hello\n");

    let origin = base.join("origin.git");
    std::fs::create_dir_all(&origin).expect("create origin directory");
    git(&origin, &["init", "-q", "--bare", "-b", "main"]);
    git(&origin, &["config", "core.hooksPath", "no-hooks"]);
    git(&root, &["remote", "add", "origin", &cwd(&origin)]);
    call("git_push", json!({ "setUpstream": true }));
    assert_eq!(git(&origin, &["rev-parse", "main"]).trim(), head(&root));

    git(&base, &["clone", "-q", &cwd(&origin), "clone"]);
    let clone = base.join("clone");
    configure(&clone);
    let remote_tip = commit_file(&clone, "remote.txt", "remote\n", "remote work");
    git(&clone, &["push", "-q", "origin", "main"]);
    call("git_fetch", json!({ "prune": false }));
    assert_eq!(call("git_status", json!({}))["behind"], 1);
    call("git_pull", json!({ "rebase": false }));
    assert_eq!(head(&root), remote_tip);

    let fresh = base.join("fresh");
    std::fs::create_dir_all(&fresh).expect("create fresh directory");
    let initialized = fixture.ok("git_init", json!({ "cwd": cwd(&fresh) }));
    assert!(initialized
        .as_str()
        .is_some_and(|message| message.contains("Initialized")));
    assert!(fresh.join(".git").is_dir());
}
