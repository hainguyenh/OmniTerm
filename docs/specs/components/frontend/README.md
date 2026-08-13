# Frontend Component Specs

Renderer component/function ownership.

## Navigation

- [Shell/layout](shell-layout.md) — app shell and pane UI
- [Workspaces](workspace.md) — workspace UI
- [Connections/sessions](connections-sessions.md) — forms/terminal/RDP
- [Settings/plugins](settings-plugins.md) — settings/theme/plugin UI
- [Hooks/utilities](hooks-utilities.md) — state and pure helpers

- [Source inventory](source-inventory.md) — every top-level renderer module/export trace

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
