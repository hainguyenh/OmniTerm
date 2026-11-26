use super::*;

fn folder(parent: &Path, name: &str) -> PathBuf {
    let path = parent.join(name);
    fs::create_dir_all(path.join("themes")).expect("create a test-run folder");
    fs::write(path.join("themes").join("a.json"), b"{}").expect("write a file in it");
    path
}

#[test]
fn only_exact_test_run_names_carry_a_process_id() {
    assert_eq!(test_run_pid("com.omniterm.tests.1234"), Some(1234));
    for name in [
        "com.omniterm.tests.",
        "com.omniterm.tests.12a",
        "com.omniterm.tests.-1",
        "com.omniterm.app",
        "com.omniterm.dev",
        "xcom.omniterm.tests.1",
    ] {
        assert_eq!(test_run_pid(name), None, "{name}");
    }
}

#[test]
fn leftovers_are_the_test_run_folders_of_ended_processes() {
    let roaming = tempfile::tempdir().expect("roaming folder");
    let local = tempfile::tempdir().expect("local folder");
    let ended = folder(roaming.path(), "com.omniterm.tests.11");
    let ended_local = folder(local.path(), "com.omniterm.tests.11");
    folder(roaming.path(), "com.omniterm.tests.22");
    folder(roaming.path(), "com.omniterm.app");
    fs::write(roaming.path().join("com.omniterm.tests.33"), b"a file").expect("write a file");

    let parents = [
        roaming.path().to_path_buf(),
        local.path().to_path_buf(),
        roaming.path().join("missing"),
    ];
    let found = find_leftovers(&parents, &|pid, _| pid == 22);
    let mut expected = vec![ended.clone(), ended_local.clone()];
    expected.sort();
    let paths: Vec<PathBuf> = found.iter().map(|d| PathBuf::from(&d.path)).collect();
    assert_eq!(paths, expected);
    assert!(found
        .iter()
        .all(|d| d.pid == 11 && d.files == 1 && d.bytes == 2));
}

#[test]
fn removal_checks_each_folder_again() {
    let dir = tempfile::tempdir().expect("data folder");
    let ended = folder(dir.path(), "com.omniterm.tests.11");
    let running = folder(dir.path(), "com.omniterm.tests.22");
    let app = folder(dir.path(), "com.omniterm.app");

    let results = remove_leftovers(&[ended.clone(), running.clone(), app.clone()], &|pid, _| {
        pid == 22
    });
    assert_eq!(results[0].error, None);
    assert_eq!(results[0].freed_bytes, 2);
    assert!(!ended.exists());
    assert!(results[1]
        .error
        .as_deref()
        .is_some_and(|e| e.contains("still running")));
    assert!(running.exists());
    assert!(results[2].error.is_some());
    assert!(app.exists());
}

#[test]
fn a_running_process_owns_only_folders_made_after_it_started() {
    let dir = tempfile::tempdir().expect("data folder");
    let mine = folder(dir.path(), "com.omniterm.tests.1");
    assert!(creator_running(std::process::id(), &mine));
    assert!(!creator_running(u32::MAX, &mine), "no such process");

    // Windows reuses process IDs: a process started after the folder existed did not create it.
    let created = UNIX_EPOCH + Duration::from_secs(1_000_000);
    assert!(could_create(created - Duration::from_secs(60), created));
    assert!(could_create(created + Duration::from_secs(1), created));
    assert!(!could_create(created + Duration::from_secs(3600), created));
}
