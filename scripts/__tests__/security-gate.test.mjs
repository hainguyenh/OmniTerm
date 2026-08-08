/**
 * The zero-credential audit itself.
 *
 * `pnpm test` and the Test Gate's security job both stand on this script, and until now nothing
 * checked that it can still *fail* — an audit that has never been seen red is indistinguishable from
 * one whose scan silently stopped matching. The negative controls below run it against a copy of the
 * repo with a violation planted in it.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  AUDITED_PATHS,
  DEFAULT_ROOT,
  FORBIDDEN_TOKENS,
  LOCAL_STORAGE_FILES,
  PERMISSION_FILES,
  PLUGIN_MANIFEST,
  RUST_PERMISSIONS,
  SCANNED_FILES,
  VAULT_MODULE,
  auditPasswordPersistence,
} from '../check-no-password-persistence.mjs'

const SCRIPT = path.join(DEFAULT_ROOT, 'scripts', 'check-no-password-persistence.mjs')

/** A copy of the repo holding only the files the audit reads, so a test can plant a violation. */
async function auditableCopy() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omniterm-audit-'))
  for (const relative of AUDITED_PATHS) {
    const destination = path.join(root, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(path.join(DEFAULT_ROOT, relative), destination)
  }
  return root
}

/**
 * Put a runnable copy of the audit inside a fixture root and return its path. The script resolves
 * the repo root from its own location, so this is the only way to point the CLI at a fixture.
 */
async function plantScript(root) {
  for (const file of ['check-no-password-persistence.mjs', 'is-main.mjs', 'credential-policy.json']) {
    await cp(path.join(DEFAULT_ROOT, 'scripts', file), path.join(root, 'scripts', file))
  }
  return path.join(root, 'scripts', 'check-no-password-persistence.mjs')
}

/**
 * Create a directory symlink, reporting whether the OS allowed it.
 *
 * Windows only permits this with Developer Mode on or SeCreateSymbolicLinkPrivilege held; without
 * it the call throws EPERM before the behaviour under test is ever exercised, so it is the
 * environment that failed, not the code. Only win32 gets that pass — on Linux, where CI runs, a
 * refused symlink is a real failure and still throws.
 */
async function trySymlinkDir(target, link) {
  try {
    await symlink(target, link, 'dir')
    return true
  } catch (err) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes(err.code)) return false
    throw err
  }
}

test('the real repository passes, through the CLI', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /No password-persistence entry points found\./)
})

test('the audit finds nothing in a faithful copy of the repository', async () => {
  const root = await auditableCopy()
  assert.deepEqual(auditPasswordPersistence(root), [])
})

test('every path the policy names still exists', async () => {
  // A rename used to surface as an uncaught ENOENT, which reads like a broken script rather than a
  // policy gap — and the instinct then is to delete the entry rather than repoint it.
  for (const relative of AUDITED_PATHS) {
    await assert.doesNotReject(readFile(path.join(DEFAULT_ROOT, relative), 'utf8'), `${relative} is gone`)
  }
})

test('a credential-persistence token in shipped source is reported with its file', async () => {
  const root = await auditableCopy()
  const target = SCANNED_FILES[1]
  await writeFile(path.join(root, target), 'export const saveCredential = () => {}\n')

  const findings = auditPasswordPersistence(root)

  assert.ok(findings.includes(`${target}: saveCredential`), findings.join('\n'))
})

test('every forbidden token is actually matched, not just the first', async () => {
  for (const token of FORBIDDEN_TOKENS) {
    const root = await auditableCopy()
    await writeFile(path.join(root, SCANNED_FILES[1]), `// ${token}\n`)
    assert.ok(
      auditPasswordPersistence(root).some((finding) => finding.endsWith(`: ${token}`)),
      `${token} is in the list but never matches`,
    )
    await rm(root, { recursive: true, force: true })
  }
})

test('a returning credential vault module is reported', async () => {
  const root = await auditableCopy()
  await mkdir(path.dirname(path.join(root, VAULT_MODULE)), { recursive: true })
  await writeFile(path.join(root, VAULT_MODULE), 'pub fn store() {}\n')

  assert.ok(auditPasswordPersistence(root).includes(`${VAULT_MODULE} still exists`))
})

test('a credentials permission is caught in the manifest, the contract, and the Rust registry', async () => {
  const manifestRoot = await auditableCopy()
  const manifest = JSON.parse(await readFile(path.join(manifestRoot, PLUGIN_MANIFEST), 'utf8'))
  manifest.omnitermPlugin.permissions = [...(manifest.omnitermPlugin.permissions ?? []), 'credentials']
  await writeFile(path.join(manifestRoot, PLUGIN_MANIFEST), JSON.stringify(manifest, null, 2))
  assert.ok(
    auditPasswordPersistence(manifestRoot).includes('Full Remote Suite still requests credentials permission'),
  )

  const contractRoot = await auditableCopy()
  const permissionFile = PERMISSION_FILES[0]
  await writeFile(path.join(contractRoot, permissionFile), "export type Permission = 'credentials'\n")
  assert.ok(
    auditPasswordPersistence(contractRoot).includes(
      `${permissionFile}: credential-storage permission still declared`,
    ),
  )

  const rustRoot = await auditableCopy()
  await writeFile(path.join(rustRoot, RUST_PERMISSIONS), 'const KNOWN: &[&str] = &["credentials"];\n')
  assert.ok(
    auditPasswordPersistence(rustRoot).includes(
      `${RUST_PERMISSIONS}: credential-storage permission still declared`,
    ),
  )
})

test('the Rust scan stops at the test module so its own assertions do not trip it', async () => {
  // plugin_management's tests name the string while proving it is rejected. Counting those would
  // leave the audit permanently red, and the fix would be to weaken the audit.
  const root = await auditableCopy()
  await writeFile(
    path.join(root, RUST_PERMISSIONS),
    ['const KNOWN: &[&str] = &["files"];', '', '#[cfg(test)]', 'mod tests {', '  const DENIED: &str = "credentials";', '}', ''].join('\n'),
  )

  assert.deepEqual(auditPasswordPersistence(root), [])
})

test('credential logic sitting next to localStorage is reported', async () => {
  const root = await auditableCopy()
  const target = LOCAL_STORAGE_FILES[0]
  await writeFile(path.join(root, target), 'localStorage.setItem("password", secret)\n')

  assert.ok(
    auditPasswordPersistence(root).includes(
      `${target}: localStorage file contains credential-related logic`,
    ),
  )
})

test('the CLI exits 1 and prints the finding', async () => {
  const root = await auditableCopy()
  await writeFile(path.join(root, SCANNED_FILES[1]), 'const x = "os-vault"\n')
  // The script resolves its root from its own location, so run a copy planted inside the fixture.
  const script = await plantScript(root)

  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })

  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stderr, /"os-vault"/)
  assert.equal(result.stdout, '')
})

test('the CLI still runs when invoked through a symlinked path', async (t) => {
  // `import.meta.url` arrives resolved through symlinks while `process.argv[1]` does not. Comparing
  // them raw made the audit exit 0 having scanned nothing — a gate that passes by not running.
  const root = await auditableCopy()
  const script = await plantScript(root)

  const linkRoot = `${root}-link`
  if (!(await trySymlinkDir(root, linkRoot))) {
    // Named rather than passed over silently: a gate you believe ran and did not is worse than none.
    t.skip('Windows refused to create a symlink (needs Developer Mode). Linux CI still runs this.')
    return
  }
  const result = spawnSync(
    process.execPath,
    [path.join(linkRoot, 'scripts', 'check-no-password-persistence.mjs')],
    { encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /No password-persistence entry points found\./)
})
