# Feature Specs

User-visible behavior grouped by product area.

## Navigation

- [Workspaces](workspaces/README.md) — composite workspaces
- [Connections](connections/README.md) — connection profiles and launch
- [Sessions](sessions/README.md) — terminal lifecycle
- [Files](files/README.md) — tree/view/edit
- [Settings](settings/README.md) — settings/themes/updates
- [Plugins](plugins/README.md) — plugin lifecycle/runtime
- [Utilities](utilities/README.md) — native helpers/quick shell

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
