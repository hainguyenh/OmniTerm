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

## Code writing rules

### Source-size limits

| File type | Maximum lines |
|---|---:|
| `.ts` | 400 |
| `.tsx` | 500 |
| `.js`, `.mjs`, `.cjs` | 350 |
| `.css` | 600 |
| `.rs` | 400 |

- Limits apply to production and test code. Generated, vendored, submodule, coverage, and build output are exempt.
- Split an oversized file by responsibility. Never compress code, remove useful whitespace, or combine unrelated statements to evade a limit.

### Warnings, unused code, and suppressions

- Treat every ESLint, TypeScript, Rust compiler, and Clippy warning as an error.
- Remove unused imports, variables, parameters, exports, files, and modules.
- Prefix a name with `_` only when a required callback signature or intentional destructuring leaves it unused. Do not use `_` to retain dead code.
- Keep lint suppression scoped to the smallest expression or line, name the exact rule, and explain why the exception is safe. Do not add file-wide disables without an explicit requirement.

### TypeScript, React, and JavaScript

- Keep TypeScript strict. Prefer `unknown` plus narrowing over `any`, and never cast only to silence the compiler.
- Validate external, persisted, versioned, plugin, and IPC data at its boundary. Keep requests, responses, and errors explicitly typed.
- Format with two-space indentation, single quotes, no semicolons, trailing commas in multiline constructs, one statement per line, a final newline, and no trailing whitespace.
- Group imports as external packages, workspace/internal modules, then relative modules, with a blank line between groups. Use `import type` for type-only dependencies.
- Use ESM in the frontend, contract, and repository scripts. Use CommonJS only in packages or sidecars that explicitly declare it.
- Use PascalCase for components and types, camelCase for functions and variables, `use*` for hooks, and UPPER_SNAKE_CASE for module-level constants.
- Prefer named exports. Reserve default exports for framework or configuration entry points that require them.
- Keep rendering pure where practical. Move domain transformations out of JSX and view components, derive values instead of mirroring them with effects, and clean up listeners, channels, subscriptions, and timers.
- Do not use `console` outside the repository's existing diagnostics and test exceptions; route application diagnostics through `diag`.
- Colocate single-use values. Extract genuinely shared or repeated domain values into focused modules instead of creating catch-all `constants.ts` or `enums.ts` files.
- Prefer literal unions or `as const` maps over TypeScript `enum` unless runtime enum behavior is required.

### Rust

- Format new or changed Rust code with `rustfmt`; code must pass Clippy with warnings denied.
- Follow Rust naming conventions and use the narrowest practical visibility.
- Do not add `unwrap` or `expect` on reachable runtime or input paths. In tests or proven internal invariants, include a useful failure message.
- Use `Result`, `?`, and meaningful error context for fallible operations. Do not panic for expected failures.
- Do not hold a lock across `.await`; avoid needless clones, allocations, collections, and owned strings.
- Preserve crate boundaries: protocol contains shared DTOs, core remains reusable and Tauri-free, and `src-tauri` stays a thin desktop adapter.

### CSS and comments

- Format CSS with two-space indentation and one declaration per line. Keep selectors shallow and specificity low.
- Prefer existing design tokens and Tailwind utilities over repeated magic values. Avoid ID selectors and unexplained `!important` declarations.
- Write comments for intent, invariants, security constraints, platform differences, or non-obvious tradeoffs. Do not narrate the code or leave TODOs without actionable context.

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
