---
id: architecture-runtime-boundaries
status: current
area: architecture
navigation: "Internal"
platforms:
  - desktop
  - tauri
tags:
  - rust
  - tauri
  - contract
related:
  - contract-ipc-persistence
  - component-rust-workspace-core
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Architecture Runtime Boundaries

## Description

Defines dependency direction between shared Rust protocol types, Tauri-free core logic, Tauri native adapters, TypeScript contracts and renderer code.

## What

Protocol/contract types define serialized data; `app-core` owns deterministic domain rules; `src-tauri` owns AppHandle/OS side effects; renderer invokes native capabilities through typed adapters.

## Why

This keeps core behavior unit-testable, native capabilities explicit, and persistence/IPC validation at clear boundaries.

## How

Rust core imports the protocol library by its declared crate name `app_protocol`; Tauri delegates to core/services; TypeScript mirrors camelCase data; renderer APIs centralize invoke names/payloads.

## When

Whenever a feature adds shared data, persistence, a Tauri command, filesystem/process behavior or renderer-native communication.

## Behavior

- Core must not depend on Tauri.
- Cargo package name and Rust library crate name are distinct; imports use `[lib] name`.
- Mutation success is returned only after native work succeeds.

## Functionalities

- `app_protocol` — owned by this spec.
- `app_core` — owned by this spec.
- `src-tauri` — owned by this spec.
- `contract/index.ts` — owned by this spec.
- `omnitermAPI` / `workspaceAPI` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| `app_protocol` | Shared Rust serde models. | One cross-crate data shape. | Export structs from `crates/app-protocol`. | Core/Tauri serialize shared data. |
| `app_core` | Tauri-free domain logic. | Fast deterministic unit testing. | Pure validation/transformation plus bounded std filesystem helpers. | Domain operation. |
| `src-tauri` | Native adapter/services. | Own OS/AppHandle resources. | Validate input, delegate, persist/launch. | IPC/native action. |
| `contract/index.ts` | TypeScript shared model. | Renderer type safety. | Mirror serialized camelCase shape. | UI consumes IPC data. |
| `omnitermAPI` / `workspaceAPI` | Renderer invoke gateways. | Central command naming/payload. | Wrap Tauri invoke/dialog/event APIs. | UI calls native behavior. |

## State and data

- Protocol structs
- Core domain values
- Native handles/process registries
- Renderer projections

## Errors and edge cases

- Wrong crate identifier fails at compile time.
- IPC name/payload drift fails contract/runtime tests.

## Security and invariants

- Renderer validation is never the final filesystem/process authorization.
- Persisted/imported data is revalidated natively.

## Verification

- `scripts/__tests__/rust-crate-imports.test.mjs`
- IPC contract tests
- Core Rust tests

## Source map

- `crates/app-protocol/Cargo.toml`
- `crates/app-protocol/src/lib.rs`
- `crates/app-core`
- `src-tauri/src/lib.rs`
- `contract/index.ts`
- `ui/omnitermAPI.ts`
