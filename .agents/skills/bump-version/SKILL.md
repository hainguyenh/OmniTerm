---
name: bump-version-skill
description: Use when the user requests a version bump or runs `/bump-version v*.*.*` to update CHANGELOG.md, update package.json files, commit changes, and tag the commit.
---

# Bump Version Skill

## Overview
This skill automates the release versioning process. When `/bump-version v*.*.*` is invoked, the AI agent updates the project's changelog with commits since the last tag, bumps the version in all `package.json` files, commits these changes, and tags the final commit.

## Triggering Condition
- Use when the user runs `/bump-version v*.*.*` (e.g., `/bump-version v1.4.2`).

## Detailed Instructions

> [!IMPORTANT]
> If the `rtk` CLI is available in the environment, you must use `rtk` wrapped commands instead of raw commands (e.g., use `rtk git ...` instead of `git ...`).


### 1. Extract Target Version
Parse the target version from the command parameter:
- **Clean version**: Strip any leading `v` (e.g., `1.4.2`) for package.json updates.
- **Tagged version**: Keep the leading `v` (e.g., `v1.4.2`) for the Git tag and changelog headings.

### 2. Identify the Last Tag
Find the last tag in the repository before the target version.
- Run `git describe --tags --abbrev=0` (or `rtk git status` / git tag commands) to get the most recent tag.
- If no tags are found, retrieve all commits from the repository's initial commit.

### 3. Update CHANGELOG.md
- Fetch all commits from the last tag to the current `HEAD`:
  - Run `git log <last-tag>..HEAD --oneline` (or `rtk git log -n 50`) to collect the list of changes.
- Prepend the new release information to the top of `CHANGELOG.md` (usually right below the main header `# Changelog`):
  ```markdown
  ## [v*.*.*] - YYYY-MM-DD

  ### Changes
  - <Commit description 1>
  - <Commit description 2>
  ```
- Save `CHANGELOG.md`.

### 4. Bump Package Versions
- Find all `package.json` files in the workspace (ignoring `node_modules` or third-party directories).
- Update the `"version"` field in each `package.json` to the **clean version** (e.g., `"version": "1.4.2"`).
- Preserve the file's original spacing and layout upon saving.

### 5. Commit & Tag the Release
- Stage all modified files (`CHANGELOG.md` and any modified `package.json` files):
  - Run `git add CHANGELOG.md package.json` (and other path package.json files if relevant).
- Commit the changes with a clean message:
  - Run `git commit -m "chore: bump version to v*.*.*"`
- Tag the commit with the target version:
  - Run `git tag -a v*.*.* -m "Release v*.*.*"`
