# Rust/Tauri Component Specs

Native/core function ownership.

## Navigation

- [Workspace core](workspace-core.md) — model/scan
- [Workspace Tauri](workspace-tauri.md) — commands/persistence
- [Filesystem/launch](filesystem-launch.md) — safepath/process
- [Sessions/connections](sessions-connections.md) — PTY/session/connection services
- [Platform/plugins/settings](platform-plugins-settings.md) — remaining native services

- [Source inventory](source-inventory.md) — every public Rust/Tauri function trace

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
