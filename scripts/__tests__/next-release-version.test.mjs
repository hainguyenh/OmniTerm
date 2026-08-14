/**
 * The release version resolver, and the workflow wiring that depends on it.
 *
 * The bug these tests exist for: `Build & Release` triggered with its defaults resolved the tag from
 * package.json, which still held the version that had already shipped. The run went green, and
 * softprops/action-gh-release found the existing release and replaced its assets in place — so a
 * successful run produced no new release and looked, from the releases page, like nothing happened.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  DEFAULT_ROOT,
  compareVersions,
  highestVersion,
  increment,
  nextVersion,
  parseVersion,
} from '../next-release-version.mjs'

const SCRIPT = path.join(DEFAULT_ROOT, 'scripts', 'next-release-version.mjs')
const workflow = fs
  .readFileSync(path.join(DEFAULT_ROOT, '.github', 'workflows', 'build-release.yml'), 'utf8')
  .replaceAll('\r\n', '\n')

test('parseVersion accepts both tag and bare forms and rejects anything else', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3])
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3])
  assert.deepEqual(parseVersion(' v0.1.0 '), [0, 1, 0])
  for (const bad of ['v1.2', '1.2.3-rc.1', 'latest', '', null, undefined]) {
    assert.equal(parseVersion(bad), null, `${bad} should not parse`)
  }
})

test('versions order numerically, not lexically', () => {
  // The whole point: "0.9.0" sorts above "0.10.0" as a string, which would pick the wrong base.
  assert.ok(compareVersions([0, 10, 0], [0, 9, 0]) > 0)
  assert.deepEqual(highestVersion(['v0.9.0', 'v0.10.0', 'v0.2.0']), [0, 10, 0])
})

test('highestVersion ignores tags that are not plain releases', () => {
  assert.deepEqual(highestVersion(['v0.1.0', 'v2.0.0-rc.1', 'nightly', 'v0.2.0']), [0, 2, 0])
  assert.equal(highestVersion(['nightly', 'v1.2']), null)
})

test('increment moves the requested part and zeroes the ones below it', () => {
  assert.deepEqual(increment([1, 4, 7], 'patch'), [1, 4, 8])
  assert.deepEqual(increment([1, 4, 7], 'minor'), [1, 5, 0])
  assert.deepEqual(increment([1, 4, 7], 'major'), [2, 0, 0])
  assert.throws(() => increment([1, 0, 0], 'build'), /Unknown bump level/)
})

test('a default run moves past the tag that already shipped', () => {
  // Exactly the reported case: repo at 0.1.0, v0.1.0 already released.
  assert.equal(nextVersion({ tags: ['v0.1.0'], current: '0.1.0' }), '0.1.1')
})

test('the first release ships the checked-in version rather than incrementing past it', () => {
  assert.equal(nextVersion({ tags: [], current: '0.1.0' }), '0.1.0')
})

test('a hand-edited version wins when it is ahead of the incremented tag', () => {
  // Otherwise a deliberate bump to 0.2.0 would be silently demoted to 0.1.1.
  assert.equal(nextVersion({ tags: ['v0.1.0'], current: '0.2.0' }), '0.2.0')
})

test('a stale checked-in version does not drag the release backwards', () => {
  assert.equal(nextVersion({ tags: ['v0.4.0', 'v0.3.0'], current: '0.1.0' }), '0.4.1')
})

test('minor and major levels increment from the highest tag', () => {
  assert.equal(nextVersion({ tags: ['v0.1.3'], current: '0.1.3', level: 'minor' }), '0.2.0')
  assert.equal(nextVersion({ tags: ['v0.1.3'], current: '0.1.3', level: 'major' }), '1.0.0')
})

test('bad input is rejected rather than guessed at', () => {
  assert.throws(() => nextVersion({ tags: ['v0.1.0'], current: '0.1.0', level: 'huge' }), /Unknown bump level/)
  assert.throws(() => nextVersion({ tags: ['v0.1.0'], current: '0.1' }), /not a bare semver/)
  assert.throws(() => nextVersion({ tags: [] }), /No release tags/)
})

test('the CLI prints one bare version for the real repository', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: DEFAULT_ROOT })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/)
})

test('the CLI rejects an unknown bump level instead of defaulting to patch', () => {
  const result = spawnSync(process.execPath, [SCRIPT, 'sideways'], { encoding: 'utf8', cwd: DEFAULT_ROOT })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unknown bump level/)
})

test('the release workflow resolves auto through this script, not package.json', () => {
  assert.match(workflow, /node scripts\/next-release-version\.mjs \$level/)
})

test('the release workflow refuses to republish a tag that already exists', () => {
  // The guard that turns the reported silent overwrite into a visible failure.
  assert.match(workflow, /git tag --list \$tag/)
  assert.match(workflow, /already exists\. Releasing it again would overwrite/)
})

test('the release workflow stamps the resolved version before building', () => {
  // Tauri names the installer from tauri.conf.json, so the stamp has to precede the build.
  const stamp = workflow.indexOf('sync-tauri-version.mjs write')
    const build = Math.max(workflow.indexOf('pnpm build:tauri:nsis'), workflow.indexOf('pnpm tauri build --bundles nsis'))
  assert.ok(stamp > -1 && build > -1)
  assert.ok(stamp < build, 'the version must be stamped before Tauri names the installer')
})

test('the release passes the bundle config through pnpm without an npm-style separator', () => {
  assert.match(
    workflow,
    /run: pnpm build:tauri:nsis --config \.omniterm-build\/tauri\.bundle-plugin\.json/,
  )
  assert.doesNotMatch(workflow, /pnpm build:tauri:nsis -- --config/)
})

test('the tag is pushed only after the build job succeeded, and master is never written to', () => {
  // A tag pushed before the build would point at a version that never shipped. And master requires
  // pull requests: a release that commits its version bump there is rejected by the branch ruleset,
  // which is exactly how the first release under that ruleset failed.
  const releaseJob = workflow.slice(workflow.indexOf('  create-release-page:'))
  assert.match(releaseJob, /git push origin "\$TAG"/)
  assert.doesNotMatch(releaseJob, /HEAD:master/)
  assert.doesNotMatch(releaseJob, /git commit/)
  assert.doesNotMatch(releaseJob, /push --force/)
  assert.match(workflow, /create-release-page:\n\s*needs: \[resolve-release-version, build-desktop-packages\]/)
})

/** Top-level jobs of build-release.yml as `{ name, needs, if }`, parsed without a YAML dependency. */
function releaseJobs() {
  const body = workflow.slice(workflow.indexOf('\njobs:\n'))
  const blocks = body.split(/\n {2}(?=[a-z][\w-]*:\n)/).slice(1)
  return blocks.map((block) => {
    const name = block.match(/^([\w-]+):/)[1]
    const needs = block.match(/\n {4}needs: \[([^\]]*)\]/)
    return {
      name,
      needs: needs ? needs[1].split(',').map((entry) => entry.trim()) : [],
      // `if:` at four spaces is the job's own; deeper ones belong to its steps.
      condition: block.match(/\n {4}if: ([\s\S]*?)(?=\n {4}\w|\n {2}\w|$)/)?.[1] ?? '',
    }
  })
}

test('every job downstream of the skipped gate re-states the condition, not just the first', () => {
  // `skipped` propagates through the entire graph. quality-gate is skipped whenever the release
  // reuses the commit's existing green run, and build-desktop-packages overriding that was not
  // enough: create-release-page inherited the skip and the run reported success having published
  // nothing — the exact "green gate that did not run" this repo refuses to ship.
  const jobs = releaseJobs()
  assert.ok(jobs.some((job) => job.name === 'quality-gate'), 'quality-gate job not found')

  const downstream = new Set(['quality-gate'])
  for (let changed = true; changed; ) {
    changed = false
    for (const job of jobs) {
      if (!downstream.has(job.name) && job.needs.some((need) => downstream.has(need))) {
        downstream.add(job.name)
        changed = true
      }
    }
  }
  downstream.delete('quality-gate')
  assert.ok(downstream.size >= 2, `expected the skip to reach several jobs, got ${[...downstream]}`)

  for (const name of downstream) {
    const { condition } = jobs.find((job) => job.name === name)
    assert.match(condition, /!cancelled\(\)/, `${name} inherits the skip instead of overriding it`)
  }
})

test('the release publishes the installer and portable package with the bundled plugin', () => {
  for (const name of ['OmniTerm-Tauri-Windows-nsis', 'OmniTerm-Windows-portable']) {
    assert.match(workflow, new RegExp(`name: ${name}\\b`), `${name} is never uploaded`)
  }
  assert.doesNotMatch(workflow, /name: OmniTerm-Plugin-always-awake\\b/)
  assert.doesNotMatch(workflow, /name: OmniTerm-Plugin-blur\\b/)
  assert.match(workflow, /-Plugins @\([\s\S]*Name = 'always-awake'[\s\S]*Name = 'blur'/)

  const publish = workflow.slice(workflow.indexOf('Publish GitHub release'))
  for (const glob of ['release-artifacts/**/*.exe', 'release-artifacts/**/*.zip']) {
    assert.ok(publish.includes(glob), `${glob} is not attached to the release`)
  }

  // download-artifact merges by this pattern; an upload named outside it is silently dropped.
  assert.match(workflow, /pattern: OmniTerm-\*/)
})

test('packaging goes through the same functions the local wizard uses', () => {
  assert.match(workflow, /\. \.\/scripts\/ReleasePackaging\.ps1/)
  assert.match(workflow, /New-PortablePackage/)

  const wizard = fs.readFileSync(path.join(DEFAULT_ROOT, 'scripts', 'Build-OmniTerm.ps1'), 'utf8')
  assert.match(wizard, /ReleasePackaging\.ps1/)
  assert.match(wizard, /New-PortablePackage/)
  assert.match(wizard, /New-PluginPackage/)
  assert.match(wizard, /Get-DefaultPortablePlugins/)
  assert.match(wizard, /Copy-PortableArtifacts[\s\S]*PortablePlugins/)
  assert.match(wizard, /Blur \(inactive-window privacy filter\)/)
})

test('portable packaging verifies the bundled plugin is present in the archive', () => {
  const packaging = fs.readFileSync(path.join(DEFAULT_ROOT, 'scripts', 'ReleasePackaging.ps1'), 'utf8')
  assert.match(packaging, /System\.IO\.Compression\.FileSystem/)
  assert.match(packaging, /Portable archive is missing bundled plugin entry/)
  assert.match(packaging, /dist\/index\.js/)
  assert.match(packaging, /plugins\\always-awake/)
  assert.match(packaging, /plugins\\blur/)
})
