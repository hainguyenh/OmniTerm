/**
 * Decide which version a release run should publish.
 *
 *   node scripts/next-release-version.mjs [patch|minor|major]
 *
 * The release workflow used to resolve the tag straight from `package.json`, which meant a run
 * triggered with the defaults re-published the version that was already out and silently overwrote
 * the existing release's assets instead of creating a new one. The version now comes from the tags
 * that have actually shipped, so a default-triggered run always moves forward.
 *
 * `package.json` still gets a vote: the answer is the LATER of "increment the highest shipped tag"
 * and "whatever the repo already says". Without that, a deliberate hand-edit to 0.2.0 would be
 * quietly demoted to 0.1.1 on the next release.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './is-main.mjs'

export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const LEVELS = Object.freeze(['patch', 'minor', 'major'])

/** Release tags only. A prerelease or a `v1.2` stub must not become the base we increment from. */
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/
const BARE_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

/** `"1.2.3"` or `"v1.2.3"` → `[1, 2, 3]`, or null when it is not a plain release version. */
export function parseVersion(value) {
  const match = RELEASE_TAG.exec(String(value ?? '').trim()) ?? BARE_SEMVER.exec(String(value ?? '').trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export const formatVersion = ([major, minor, patch]) => `${major}.${minor}.${patch}`

/** Numeric, component-wise — string ordering would rank 0.10.0 below 0.9.0. */
export function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

/** The highest release tag in the list, or null when nothing has shipped yet. */
export function highestVersion(tags) {
  const parsed = tags.map(parseVersion).filter(Boolean)
  if (parsed.length === 0) return null
  return parsed.reduce((best, current) => (compareVersions(current, best) > 0 ? current : best))
}

export function increment([major, minor, patch], level) {
  if (level === 'major') return [major + 1, 0, 0]
  if (level === 'minor') return [major, minor + 1, 0]
  if (level === 'patch') return [major, minor, patch + 1]
  throw new Error(`Unknown bump level "${level}". Expected one of: ${LEVELS.join(', ')}.`)
}

/**
 * The version to publish, as a bare `X.Y.Z`.
 *
 * With no tags at all this is the repo's current version — the first release ships what is checked
 * in rather than incrementing past it.
 */
export function nextVersion({ tags = [], current, level = 'patch' } = {}) {
  if (!LEVELS.includes(level)) {
    throw new Error(`Unknown bump level "${level}". Expected one of: ${LEVELS.join(', ')}.`)
  }

  const currentVersion = parseVersion(current)
  if (current !== undefined && !currentVersion) {
    throw new Error(`Current version "${current}" is not a bare semver (X.Y.Z).`)
  }

  const highest = highestVersion(tags)
  if (!highest) {
    if (!currentVersion) throw new Error('No release tags and no current version to fall back on.')
    return formatVersion(currentVersion)
  }

  const bumped = increment(highest, level)
  if (currentVersion && compareVersions(currentVersion, bumped) > 0) return formatVersion(currentVersion)
  return formatVersion(bumped)
}

/** Every tag git knows about. Requires a checkout with tags fetched (`fetch-depth: 0`). */
export function gitTags(root = DEFAULT_ROOT) {
  const output = execFileSync('git', ['tag', '--list', 'v*.*.*'], { cwd: root, encoding: 'utf8' })
  return output.split('\n').map((line) => line.trim()).filter(Boolean)
}

export function currentVersion(root = DEFAULT_ROOT) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
}

function main() {
  const level = process.argv[2] ?? 'patch'
  try {
    process.stdout.write(`${nextVersion({ tags: gitTags(), current: currentVersion(), level })}\n`)
  } catch (err) {
    console.error(`[next-release-version] ${err.message}`)
    process.exit(1)
  }
}

if (isMain(import.meta.url)) main()
