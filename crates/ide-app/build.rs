fn main() {
    // Read when the script runs: a path compiled into the script would outlive a move of the checkout.
    let manifest_dir =
        std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let root = dunce::canonicalize(manifest_dir.join("../..")).expect("worktree root");
    // Read by `src/dev.rs` to name a per-worktree identifier in debug builds.
    println!("cargo:rustc-env=OMNITERM_WORKTREE_ROOT={}", root.display());
    // `src/lib.rs` marks `run` with `#[cfg_attr(mobile, …)]`; `tauri_build`
    // declares that cfg, and this crate does not run `tauri_build`, so it is declared here.
    println!("cargo::rustc-check-cfg=cfg(mobile)");
}
