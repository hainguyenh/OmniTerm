/**
 * The zero-credential policy, checked from the renderer suite as well as from `pnpm test:security`.
 *
 * The file and token lists come from `scripts/credential-policy.json`, the same data the audit
 * script reads. They used to be restated here, which meant a token added to one copy silently left
 * the other scanning an out-of-date policy — and the stale copy is always the one nobody re-reads.
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import policy from '../../scripts/credential-policy.json'

const root = path.resolve(process.cwd())

/** Every path the policy names, deduplicated. */
const auditedPaths = [
  ...new Set([
    ...policy.scannedFiles,
    ...policy.permissionFiles,
    ...policy.localStorageFiles,
    policy.pluginManifest,
    policy.rustPermissions,
  ]),
]

describe('password persistence removal', () => {
  it('has no credential vault implementation', () => {
    expect(fs.existsSync(path.join(root, policy.vaultModule))).toBe(false)
  })

  it('has no password persistence entry points in shipped source', () => {
    const findings: string[] = []
    for (const relative of policy.scannedFiles) {
      const content = fs.readFileSync(path.join(root, relative), 'utf8')
      for (const token of policy.forbiddenTokens) {
        if (content.includes(token)) findings.push(`${relative}: ${token}`)
      }
    }
    expect(findings).toEqual([])
  })

  it('does not grant plugins a credential-storage permission', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, policy.pluginManifest), 'utf8'))
    expect(manifest.omnitermPlugin.permissions).not.toContain('credentials')
  })

  it('still scans every file the policy names', () => {
    // A rename used to surface as an uncaught ENOENT from the audit script, which reads like a
    // broken tool rather than a policy gap — and the instinct is then to drop the entry.
    for (const relative of auditedPaths) {
      expect(fs.existsSync(path.join(root, relative)), `${relative} is gone`).toBe(true)
    }
  })

  it('declares a non-empty policy', () => {
    // An emptied list would make every scan above pass while checking nothing.
    expect(policy.scannedFiles.length).toBeGreaterThan(0)
    expect(policy.forbiddenTokens.length).toBeGreaterThan(0)
    expect(policy.permissionFiles.length).toBeGreaterThan(0)
  })
})
