# Workspace Feature Specs

Routing for this product feature.

## Navigation

- [Model & persistence](model-persistence.md) — schema/migration
- [Import](import.md) — VS Code/VSCodium import
- [Hierarchy/order](hierarchy-order.md) — nest/reorder
- [Tree/filter/pins](tree-filter-pins.md) — multi-root tree/filter/pins
- [Operations](operations.md) — folder-scoped IO/run

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
