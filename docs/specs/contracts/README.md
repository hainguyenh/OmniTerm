# Contract Specs

Serialized and runtime boundaries.

## Navigation

- [Workspace contract](workspace-contract.md) — workspace model/logical path
- [IPC/persistence](ipc-persistence.md) — command/storage contract
- [Session/plugin contract](session-plugin-contract.md) — runtime events/RPC

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
