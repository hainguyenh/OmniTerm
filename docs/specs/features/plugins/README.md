# Plugin Feature Specs

Routing for this product feature.

## Navigation

- [Lifecycle/runtime](lifecycle-runtime.md) — management, host, RPC
- [Agent Quota](agent-quota.md) — AI agent quota lines, limits, suspend and wake-up
- [VS Code Launch](vscode-launch.md) — .vscode/launch.json runner, background watchers, and multi-console drawer

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
