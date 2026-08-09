---
name: bump-version
description: Use when the user requests a version bump or runs `/bump-version v*.*.*` to update all version files, generate CHANGELOG.md from commits since the last tag, commit changes, and tag the release commit.
---

# Bump Version Skill

## Overview

This skill automates the full release versioning process for OmniTerm. When `/bump-version v*.*.*` is invoked, the AI agent:

1. Validates and normalises the target version.
2. Writes the new version to **all 5 version-bearing files** via `sync-tauri-version.mjs`.
3. Generates a CHANGELOG section from git commits since the last tag (excluding bump housekeeping commits).
4. Prepends the CHANGELOG section to `CHANGELOG.md`.
5. Stages all modified files, commits with `chore: bump version to vX.Y.Z`, and tags the commit.

## Triggering Condition

Use when the user runs `/bump-version v*.*.*` (e.g., `/bump-version v0.2.0`).

## Detailed Instructions

> [!IMPORTANT]
> If the `rtk` CLI is available in the environment, use `rtk` wrapped commands instead of raw commands (e.g., `rtk git ...` instead of `git ...`). Except commands starting with `engram`.

---

### 1. Extract and Validate the Target Version

Parse the target version from the command parameter:

- **Tagged version** (`v0.2.0`): keep the `v` prefix for git tags and CHANGELOG headings.
- **Clean version** (`0.2.0`): strip the `v` for writing to version files.
- Reject any non-semver input (must be `X.Y.Z`).

---

### 2. Run the Bump Script

The primary way to execute is via the npm script:

```bash
pnpm bump:version <version>
# e.g.
pnpm bump:version 0.2.0
# or with v-prefix (auto-stripped):
pnpm bump:version v0.2.0
```

Alternatively, invoke the script directly:

```bash
node scripts/bump-version.mjs <version>
```

This script performs **steps 3–7** automatically. If you need to run steps manually, follow the sections below.

---

### 3. Version Files Updated

The script writes the version to **all 5 files** (via `sync-tauri-version.mjs write <version>`):

| File | Format |
|---|---|
| `package.json` | `"version": "X.Y.Z"` |
| `src-tauri/tauri.conf.json` | `"version": "X.Y.Z"` |
| `src-tauri/Cargo.toml` | `version = "X.Y.Z"` (first `[package]` key only) |
| `crates/app-core/Cargo.toml` | `version = "X.Y.Z"` |
| `crates/app-protocol/Cargo.toml` | `version = "X.Y.Z"` |

> [!NOTE]
> `contract/package.json` intentionally stays at `0.0.0` (it is a pnpm workspace alias, not versioned independently). Plugin `package.json` files track the host version but are **not** auto-updated by this script — update them manually if a coordinated plugin release is needed.

---

### 4. CHANGELOG Generation

The script:

1. Finds the most recent git tag via `git describe --tags --abbrev=0`.
2. Collects `git log <last-tag>..HEAD --pretty=format:%s`.
3. Filters out `chore: bump version …` commits so the changelog only lists real changes.
4. Groups commits by conventional-commit type:
   - `feat` → **Added**
   - `fix` → **Fixed**
   - `refactor` → **Refactored**
   - `test` → **Tests**
   - `ci` → **CI**
   - `plugin` → **Plugins**
   - `chore/build/docs/style/perf` → **Changed**
   - everything else → **Other**
5. Prepends the new section directly below `# Changelog` in `CHANGELOG.md`:

```markdown
## [vX.Y.Z] — YYYY-MM-DD

### Added
- feat: some new feature

### Fixed
- fix: some bug fix
```

---

### 5. Manual Steps (if the script cannot run)

If running the script manually:

#### 5a. Sync Versions

```bash
node scripts/sync-tauri-version.mjs write <version>
# or
pnpm version:sync <version>
```

#### 5b. Build the Changelog Section

```bash
# Get last tag
git describe --tags --abbrev=0

# Collect commits since last tag (exclude bump commits)
git log <last-tag>..HEAD --oneline
```

Prepend the formatted section to `CHANGELOG.md` (see format above).

#### 5c. Validate All Files Are in Sync

```bash
node scripts/sync-tauri-version.mjs validate
# or
pnpm version:validate
```

#### 5d. Commit and Tag

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
        crates/app-core/Cargo.toml crates/app-protocol/Cargo.toml CHANGELOG.md
git commit -m "chore: bump version to vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

---

## Hardcoded Version Audit (Historical)

The following version drifts were found and fixed in the codebase. All 5 version-bearing files now use `sync-tauri-version.mjs` as the single source of truth:

| File | Status |
|---|---|
| `package.json` | ✅ Source of truth |
| `src-tauri/tauri.conf.json` | ✅ Fixed (was drifted at `0.1.0` while package.json was `0.1.1`) |
| `src-tauri/Cargo.toml` | ✅ Fixed (was `0.1.0`) |
| `crates/app-core/Cargo.toml` | ✅ Fixed (was `0.1.0`, now added to sync surface) |
| `crates/app-protocol/Cargo.toml` | ✅ Fixed (was `0.1.0`, now added to sync surface) |
| `contract/package.json` | ℹ️ Intentionally `0.0.0` (workspace alias) |
| `plugins/*/package.json` | ℹ️ Plugin-level versioning — update manually on plugin releases |

Test strings in `scripts/__tests__/*.test.mjs` that reference version numbers (e.g. `0.1.0`) are **fixture values**, not hardcoded release versions — they are correctly used as test data.

---

## Available npm Scripts

| Command | Description |
|---|---|
| `pnpm bump:version <ver>` | Full release: sync versions → generate CHANGELOG → commit → tag |
| `pnpm version:sync <ver>` | Only write version to all 5 files |
| `pnpm version:validate` | Validate all 5 files are in sync |
