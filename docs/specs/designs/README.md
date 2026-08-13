# Design Records

Approved architectural choices.

## Navigation

- [Composite workspace design](composite-workspaces.md) — multi-root/nesting/migration rationale

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
