# Session Feature Specs

Routing for this product feature.

## Navigation

- [Terminal lifecycle](terminal-lifecycle.md) — renderer session behavior
- [PTY/detach](pty-detach.md) — native runtime and windows
- [Terminal status & link menu](terminal-status-link-menu.md) — running indicator signal, oscillating dot, right-click link/path overlay

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
