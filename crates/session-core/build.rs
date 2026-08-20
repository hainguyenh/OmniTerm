// session-core uses `#[cfg_attr(coverage, ...)]` to mark code that is
// uncoverable by tests (daemon main loops, defensive broadcast arms) so the
// coverage build can exclude it via the unstable `coverage_attribute`. Only
// `scripts/run-rust-coverage.mjs` sets `--cfg coverage`; this directive keeps
// `cargo build`/`cargo test` clean of `unexpected_cfgs` warnings while the cfg
// itself is absent for ordinary builds.
fn main() {
    println!("cargo::rustc-check-cfg=cfg(coverage)");
}
