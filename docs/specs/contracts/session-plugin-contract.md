---
id: contract-session-plugin
status: current
area: contracts
navigation: "Runtime events / plugin RPC"
platforms:
  - desktop
  - tauri
tags:
  - session
  - plugin
  - events
  - rpc
related:
  - feature-terminal-lifecycle
  - feature-plugin-lifecycle-runtime
properties:
  normative: true
  detail_level: component-function
  update_policy: code-and-spec-together
---

# Contract Session Plugin

## Description

Defines asynchronous runtime identity/event contracts for terminal sessions and plugin host RPC/reverse calls.

## What

Sessions communicate using native-known IDs and output/status/open events; plugins communicate using explicit RPC methods/payloads and approved reverse-call dispatch.

## Why

Async boundaries need stable identity and constrained method surfaces to avoid stale state or arbitrary native dispatch.

## How

Native registries own runtime state. Renderer subscribes/cleans channels by session ID. Shell-open requests can queue until renderer readiness. Plugin host parses messages and dispatches only known methods.

## When

Whenever PTY/session output/status/open events flow or plugin host exchanges runtime messages.

## Behavior

- Session events refer to known native IDs.
- Renderer readiness can defer shell-open delivery.
- Unsupported plugin methods are rejected.

## Functionalities

- `Session ID` — owned by this spec.
- `shell-open` event` — owned by this spec.
- `createSessionChannel` — owned by this spec.
- `Plugin RPC message` — owned by this spec.
- `handle_reverse_call` — owned by this spec.
- `disabled_descriptor` — owned by this spec.

## Components and functions

| Component | What | Why | How | When |
|---|---|---|---|---|
| Session ID | Stable native runtime identity. | Route IO/status/window attachment. | Created/owned natively and carried in events. | Live session. |
| `shell-open` event | Notify renderer of ad-hoc/launcher shell. | Bridge native/external open request. | Queue until `shells_ready`, then emit structured connection intent. | Shell request. |
| `createSessionChannel` | Renderer subscription lifecycle. | Consistent stream binding/cleanup. | Subscribe callbacks keyed by session ID. | Terminal attach. |
| Plugin RPC message | Structured plugin host request/response. | Avoid arbitrary in-process execution. | Method/id/payload serialization through host transport. | Plugin runtime. |
| `handle_reverse_call` | Approved plugin→app dispatcher. | Constrain capabilities. | Explicit method match and payload validation. | Reverse RPC. |
| `disabled_descriptor` | Unavailable plugin contract. | Graceful failure state. | Return explicit disabled metadata. | Plugin cannot run. |

## State and data

- Session registry/events
- Renderer subscriptions
- Plugin host process
- RPC pending calls/descriptors

## Errors and edge cases

- Unknown session/method or channel/sidecar closure returns/produces explicit error/state transition.

## Security and invariants

- Plugin reverse API is explicit; session event payloads do not grant arbitrary launch authority.

## Verification

- IPC runtime/session tests
- plugin host RPC/API/integration tests

## Source map

- `src-tauri/src/session_output.rs`
- `src-tauri/src/adhoc.rs`
- `ui/utils/sessionChannel.ts`
- `src-tauri/src/plugin_host_rpc.rs`
- `src-tauri/src/plugin_host_api.rs`
