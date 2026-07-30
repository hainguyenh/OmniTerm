fn main() {
  println!("cargo:rerun-if-changed=icons/icon.ico");
  // The Windows app manifest is embedded here instead (see `embed_windows_app_manifest`), so ask
  // tauri-build not to embed its own — two RT_MANIFEST resources with the same id is a hard
  // `CVT1100: duplicate resource` at link time.
  let attributes = tauri_build::Attributes::new()
    .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
  tauri_build::try_build(attributes).expect("failed to run tauri-build");
  embed_windows_app_manifest();
}

/// Embed `windows-app-manifest.xml` into every Windows artifact, test harnesses included.
///
/// `rfd` — reached through `plugin_management.rs`'s message dialogs — imports `TaskDialogIndirect`,
/// which only exists in comctl32 v6. Binding to v6 requires an RT_MANIFEST declaring a side-by-side
/// dependency on `Microsoft.Windows.Common-Controls` 6.0.0.0; without one the loader resolves
/// imports against `System32\comctl32.dll`, which is still the 5.82 stub and exports no such symbol.
/// The process then dies during startup with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139).
///
/// `tauri_build::build()` would embed an equivalent manifest, but passes it to the linker as
/// `cargo:rustc-link-arg-bins`, covering only `omniterm.exe`. `cargo test` never got one and could
/// not launch its harness. `rustc-link-arg-tests` is not the fix either: it reaches only targets
/// under `tests/`, whereas every test here is an in-crate `#[cfg(test)]` module linked into the
/// `--lib` unittest binary. Hence the unscoped, all-artifacts form that `compile_for_everything`
/// emits.
fn embed_windows_app_manifest() {
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
    return;
  }

  let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
  println!("cargo:rerun-if-changed={}", manifest.display());

  // 1 is CREATEPROCESS_MANIFEST_RESOURCE_ID and 24 is RT_MANIFEST.
  let script = std::path::Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR is always set"))
    .join("app-manifest.rc");
  std::fs::write(
    &script,
    format!("1 24 \"{}\"\n", manifest.display().to_string().replace('\\', "\\\\")),
  )
  .expect("failed to write the app manifest resource script");

  embed_resource::compile_for_everything(&script, embed_resource::NONE)
    .manifest_required()
    .expect("failed to embed the Windows app manifest");
}
