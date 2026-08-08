/**
 * The zero-credential audit: OmniTerm must have no way to persist a password, anywhere.
 *
 * Run by `pnpm test` and by the Test Gate's security job. The policy itself lives in
 * `credential-policy.json` so that `ui/security/noPasswordPersistence.test.ts` scans the same lists
 * rather than keeping a second hand-maintained copy — two copies of a security list drift, and the
 * copy that drifts is the one nobody is watching.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './is-main.mjs'

export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const policy = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'credential-policy.json'), 'utf8'),
)

/** Shipped source that must never name a credential-persistence entry point. */
export const SCANNED_FILES = Object.freeze(policy.scannedFiles)
export const FORBIDDEN_TOKENS = Object.freeze(policy.forbiddenTokens)
/** Files that enumerate the plugin permission set; none may offer a credentials permission. */
export const PERMISSION_FILES = Object.freeze(policy.permissionFiles)
/** UI files that touch localStorage — none may put credential-shaped logic beside it. */
export const LOCAL_STORAGE_FILES = Object.freeze(policy.localStorageFiles)

export const VAULT_MODULE = policy.vaultModule
export const PLUGIN_MANIFEST = policy.pluginManifest
export const RUST_PERMISSIONS = policy.rustPermissions

/** Every path this audit reads, so a rename surfaces as a policy gap rather than an ENOENT. */
export const AUDITED_PATHS = Object.freeze([
  ...new Set([
    ...SCANNED_FILES,
    ...PERMISSION_FILES,
    ...LOCAL_STORAGE_FILES,
    PLUGIN_MANIFEST,
    RUST_PERMISSIONS,
  ]),
])

const CREDENTIALS_PERMISSION = /["']credentials["']/

/** Audit `root`; returns one string per violation, empty when the policy holds. */
export function auditPasswordPersistence(root = DEFAULT_ROOT) {
  const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
  const findings = []

  if (fs.existsSync(path.join(root, VAULT_MODULE))) {
    findings.push(`${VAULT_MODULE} still exists`)
  }

  for (const relative of SCANNED_FILES) {
    const content = read(relative)
    for (const token of FORBIDDEN_TOKENS) {
      if (content.includes(token)) findings.push(`${relative}: ${token}`)
    }
  }

  const manifest = JSON.parse(read(PLUGIN_MANIFEST))
  if (manifest.omnitermPlugin?.permissions?.includes('credentials')) {
    findings.push('Full Remote Suite still requests credentials permission')
  }

  for (const relative of PERMISSION_FILES) {
    if (CREDENTIALS_PERMISSION.test(read(relative))) {
      findings.push(`${relative}: credential-storage permission still declared`)
    }
  }

  // Sliced at the first `#[cfg(test)]`: the Rust tests legitimately name the string while asserting
  // that it is rejected, and counting those would make the audit permanently red.
  const rustPermissions = read(RUST_PERMISSIONS).split('#[cfg(test)]')[0]
  if (CREDENTIALS_PERMISSION.test(rustPermissions)) {
    findings.push(`${RUST_PERMISSIONS}: credential-storage permission still declared`)
  }

  for (const relative of LOCAL_STORAGE_FILES) {
    const content = read(relative)
    if (content.includes('localStorage') && /password|credential|secret/i.test(content)) {
      findings.push(`${relative}: localStorage file contains credential-related logic`)
    }
  }

  return findings
}

if (isMain(import.meta.url)) {
  const findings = auditPasswordPersistence()
  if (findings.length) {
    console.error(findings.join('\n'))
    process.exit(1)
  }
  console.log('No password-persistence entry points found.')
}
