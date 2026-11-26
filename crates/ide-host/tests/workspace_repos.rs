use ide_core::NullSink;
use ide_host::{Host, HostConfig, ops};
use std::{path::Path, sync::Arc, time::Duration};

fn git_init(dir: &Path) {
    let ok = std::process::Command::new("git").args(["init", "-q"]).current_dir(dir).status().unwrap().success();
    assert!(ok, "git init in {}", dir.display());
}

async fn wait_for_repos(project: &ide_host::Project, count: usize) -> Vec<std::path::PathBuf> {
    for _ in 0..1000 {
        if project.repos().all().len() == count {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    project.repos().roots()
}

/// Regression: the repository list (Commit, Git branches) follows workspace edits and a
/// `git init` inside an attached member outside the project folder.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repositories_follow_attached_members_and_their_git_init() {
    let temp = tempfile::tempdir().unwrap();
    let base = dunce::canonicalize(temp.path()).unwrap();
    // The member sorts before the project: the project's repository must stay primary.
    let (primary, member) = (base.join("z-primary"), base.join("a-member"));
    for root in [&primary, &member] {
        std::fs::create_dir(root).unwrap();
        std::fs::write(root.join("file.txt"), "x").unwrap();
    }
    git_init(&primary);
    std::fs::create_dir(base.join("config")).unwrap();
    let host = Host::new(HostConfig {
        config_dir: base.join("config"),
        data_dir: base.join("data"),
        local_data_dir: base.join("data"),
        languages: Arc::new(ide_language::LanguageRegistry::load(None).unwrap()),
        syntax: Arc::default(),
        sink_for: Box::new(|_| Arc::new(NullSink)),
        owner: |w| w,
        runtime: tokio::runtime::Handle::current(),
        project_environment: false,
    });
    host.trust.decide(&primary, true, false).unwrap();
    host.trust.decide(&member, true, false).unwrap();
    let project = host.open_project("main", &primary).unwrap();
    assert_eq!(wait_for_repos(&project, 1).await, std::slice::from_ref(&primary));

    ops::project::attach_workspace(&host, "main", &member).unwrap();
    assert_eq!(project.repos().roots(), std::slice::from_ref(&primary), "a member outside git adds no repository");

    git_init(&member);
    assert_eq!(wait_for_repos(&project, 2).await, [member.clone(), primary.clone()], "member's git init is picked up");
    assert_eq!(project.repos().primary().unwrap().root(), primary);
    let roots = ops::vcs::vcs_roots(&host, "main").unwrap();
    assert_eq!(roots[0].root.as_ref(), primary.as_path(), "the project's repository is listed first");

    ops::project::save_workspace(&host, "main", "Primary", vec![primary.clone()]).unwrap();
    assert_eq!(
        project.repos().roots(),
        std::slice::from_ref(&primary),
        "a detached member's repository leaves the list"
    );
    host.close_project("main");
}
