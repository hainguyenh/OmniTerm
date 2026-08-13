# OmniTerm Software Specifications

Normative routing index for OmniTerm architecture, user-visible features, implementation components, contracts and approved designs.

## Navigation

- [Architecture](architecture/README.md) — cross-cutting runtime, security and windowing rules
- [Features](features/README.md) — user-visible product behavior
- [Components](components/README.md) — frontend and Rust/Tauri responsibilities
- [Contracts](contracts/README.md) — IPC, persistence and serialized models
- [Designs](designs/README.md) — approved design decisions

## Spec conventions

- Leaf specs describe current implemented behavior.
- Leaf specs are updated in the same change as behavior.
- Every leaf carries routing metadata and a What / Why / How / When component/function catalog.
- Rust/Tauri source remains the executable source of truth; these specs define intent, boundaries, invariants and expected behavior.
