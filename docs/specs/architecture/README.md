# Architecture Specs

Cross-cutting ownership and boundaries.

## Navigation

- [Application shell](application-shell.md) — renderer composition
- [Runtime boundaries](runtime-boundaries.md) — contract/core/Tauri/renderer layers
- [Dev server stability](dev-server-stability.md) — Windows-only `tauri dev` lifecycle and watcher invariant
- [Security and data](security-data.md) — trust boundaries
- [Windowing/layouts](windowing-layouts.md) — pane and detached-window behavior

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
