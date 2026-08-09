# OmniTerm Agent Guide

This file is the canonical repository instruction source. Keep tool-specific files as imports only.

## Project map

- `ui/`: React and TypeScript frontend.
- `crates/app-protocol/`: shared Rust DTOs and protocol types; no Tauri dependency.
- `crates/app-core/`: reusable Rust domain and I/O services; no Tauri dependency.
- `src-tauri/`: Tauri 2 desktop adapter and plugin sidecar host.
- `contract/`: shared TypeScript plugin contract.
- `plugins/`: unsandboxed optional Node.js plugins.
- `scripts/`: build, quality, release, and repository guard tooling.

## Workflow

- Read nearby implementation and tests before editing. Follow established patterns and keep changes narrow.
- Preserve public runtime and API behavior unless the task explicitly changes it.
- Do not upgrade or add dependencies unless the user requests it or the change cannot be completed without it.
- Use `pnpm` exclusively for JavaScript and TypeScript commands; do not use npm or yarn.
- Do not commit or push unless the user explicitly asks.

## Tests and quality gates

- Every feature or functional behavior change requires unit tests. Every bug fix requires a regression test.
- Pure documentation or configuration-only changes may omit new unit tests when they cannot affect behavior.
- Run the narrowest relevant tests first. Run `pnpm test:quality`, then `pnpm check:push` before declaring implementation complete.
- Never use `--no-verify` or another hook/gate bypass unless the user explicitly authorizes that exact bypass.

## Git and GitHub identity

- Before committing, pushing, or mutating GitHub state, establish the repository-local lock with `pnpm identity:setup`.
- The hooks enforce the locked author, committer, GitHub.com HTTPS credential, remote username, commit-message policy, and outgoing commits.
- For GitHub mutations such as creating or merging pull requests, editing issues, or publishing releases, use `pnpm github -- <gh args>`. Agents must not run a raw mutating `gh` command.
- Do not change the machine-wide active `gh` account or global Git identity. Never print, log, commit, or otherwise expose authentication tokens.
- Identity guard v1 supports only `github.com` remotes over HTTPS. SSH and GitHub Enterprise must fail closed until explicitly supported.
