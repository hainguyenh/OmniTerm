#!/usr/bin/env node
/**
 * Bump the project version to a specific target and record the release.
 *
 *   node scripts/bump-version.mjs <version>
 *   # e.g.  node scripts/bump-version.mjs 0.2.0
 *   #        node scripts/bump-version.mjs v0.2.0   (leading "v" is stripped)
 *
 * What this script does:
 *   1. Validates the target version is a bare semver (X.Y.Z).
 *   2. Writes the new version to all 5 version-bearing files via sync-tauri-version.mjs.
 *   3. Resolves the previous git tag to use as the changelog range base.
 *   4. Gathers git log from that tag (or root) to HEAD, filters housekeeping commits
 *      (chore: bump version …) so the changelog only lists real changes.
 *   5. Prepends a new section to CHANGELOG.md.
 *   6. Stages all modified files, commits with "chore: bump version to v<version>",
 *      and tags the commit "v<version>".
 */

import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { write as syncVersions } from './sync-tauri-version.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEMVER = /^\d+\.\d+\.\d+$/

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts }).trim()
}

function git(...args) {
  return run('git', args)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

/** Strip leading "v" so callers can pass either "0.2.0" or "v0.2.0". */
function cleanVersion(raw) {
  return raw.startsWith('v') ? raw.slice(1) : raw
}

/** Returns the most recent tag reachable from HEAD, or null when none exist. */
function lastTag() {
  try {
    return git('describe', '--tags', '--abbrev=0')
  } catch {
    return null
  }
}

/**
 * Collect commit subjects since `base` (exclusive) to HEAD.
 * Filters out any bump-version housekeeping commits to keep the changelog
 * focused on real changes.
 */
function changesSince(base) {
  const range = base ? `${base}..HEAD` : 'HEAD'
  const log = base
    ? git('log', range, '--pretty=format:%s')
    : git('log', '--pretty=format:%s')

  return log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^chore:\s+bump\s+version/i.test(line))
}

/** Group commit subjects by conventional-commit prefix for readability. */
function groupChanges(subjects) {
  const groups = {
    Added: [],
    Fixed: [],
    Changed: [],
    Refactored: [],
    Tests: [],
    CI: [],
    Plugins: [],
    Other: [],
  }

  const PREFIX_MAP = [
    [/^feat(\(.+\))?[!:]/, 'Added'],
    [/^fix(\(.+\))?[!:]/, 'Fixed'],
    [/^refactor(\(.+\))?[!:]/, 'Refactored'],
    [/^test(\(.+\))?[!:]/, 'Tests'],
    [/^ci(\(.+\))?[!:]/, 'CI'],
    [/^plugin(\(.+\))?[!:]/, 'Plugins'],
    [/^(chore|build|docs|style|perf)(\(.+\))?[!:]/, 'Changed'],
  ]

  for (const subject of subjects) {
    let placed = false
    for (const [pattern, group] of PREFIX_MAP) {
      if (pattern.test(subject)) {
        groups[group].push(subject)
        placed = true
        break
      }
    }
    if (!placed) groups['Other'].push(subject)
  }

  return groups
}

function buildChangelogSection(version, subjects) {
  const groups = groupChanges(subjects)
  const lines = [`## [v${version}] — ${today()}`, '']

  for (const [heading, items] of Object.entries(groups)) {
    if (items.length === 0) continue
    lines.push(`### ${heading}`)
    for (const item of items) lines.push(`- ${item}`)
    lines.push('')
  }

  return lines.join('\n')
}

function prependChangelog(section) {
  const changelogPath = path.join(root, 'CHANGELOG.md')
  const existing = readFileSync(changelogPath, 'utf8')

  // Insert after the first "# Changelog" header line
  const headerMatch = /^# .+$/m.exec(existing)
  if (headerMatch) {
    const insertAt = headerMatch.index + headerMatch[0].length
    const updated =
      existing.slice(0, insertAt) + '\n\n' + section + existing.slice(insertAt).replace(/^\n+/, '\n')
    writeFileSync(changelogPath, updated, 'utf8')
  } else {
    // No header found — just prepend
    writeFileSync(changelogPath, section + '\n' + existing, 'utf8')
  }
  console.log('[bump-version] Updated CHANGELOG.md')
}

function stageFiles() {
  // Stage the 5 version files + CHANGELOG
  const versionFiles = [
    'package.json',
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml',
    'crates/app-core/Cargo.toml',
    'crates/app-protocol/Cargo.toml',
    'CHANGELOG.md',
  ]
  git('add', ...versionFiles)
  console.log('[bump-version] Staged modified files')
}

function commitAndTag(version) {
  const tagName = `v${version}`
  git('commit', '-m', `chore: bump version to ${tagName}`)
  git('tag', '-a', tagName, '-m', `Release ${tagName}`)
  console.log(`[bump-version] Committed and tagged as ${tagName}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const rawVersion = process.argv[2]
  if (!rawVersion) {
    console.error('Usage: node scripts/bump-version.mjs <version>')
    console.error('  e.g. node scripts/bump-version.mjs 0.2.0')
    process.exit(1)
  }

  const version = cleanVersion(rawVersion)
  if (!SEMVER.test(version)) {
    console.error(`[bump-version] "${rawVersion}" is not a valid semver (X.Y.Z).`)
    process.exit(1)
  }

  console.log(`[bump-version] Bumping to v${version} …`)

  // 1. Write version to all 5 version-bearing files
  syncVersions(version, root)

  // 2. Determine changelog range
  const base = lastTag()
  console.log(`[bump-version] Collecting changes since ${base ?? '(initial commit)'} …`)

  // 3. Collect + filter commits
  const subjects = changesSince(base)
  if (subjects.length === 0) {
    console.warn('[bump-version] No commits found since last tag — CHANGELOG section will be empty.')
  }

  // 4. Prepend CHANGELOG
  const section = buildChangelogSection(version, subjects)
  prependChangelog(section)

  // 5. Stage, commit, tag
  stageFiles()
  commitAndTag(version)

  console.log(`[bump-version] ✓  Released v${version}`)
}

main()
