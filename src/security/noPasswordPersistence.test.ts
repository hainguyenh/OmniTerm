import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd())

const sourceFiles = [
  'contract/index.ts',
  'src/omnitermAPI.ts',
  'src/vite-env.d.ts',
  'src/components/ConnectionForm.tsx',
  'src-tauri/Cargo.toml',
  'src-tauri/src/lib.rs',
  'src-tauri/src/main.rs',
  'src-tauri/src/plugin_host_api.rs',
  'src-tauri/src/pty_resolve.rs',
  'src-tauri/sidecar/host-api.cjs',
  'plugins/full-connection-manager/package.json',
  'plugins/full-connection-manager/src/index.ts',
  'plugins/full-connection-manager/src/store.ts',
  'plugins/full-connection-manager/src/types.ts',
  'plugins/native-batch-connections/src/store.ts',
  'plugins/native-batch-connections/src/types.ts',
]

const forbidden = [
  'prompt_save_connection_credential',
  'saveCredential',
  'CredWriteW',
  'Win32_Security_Credentials',
  'credentials.get',
  'credentials.set',
  'credentials.delete',
  "'os-vault'",
  '"os-vault"',
]

describe('password persistence removal', () => {
  it('has no credential vault implementation', () => {
    expect(fs.existsSync(path.join(root, 'src-tauri/src/credential_vault.rs'))).toBe(false)
  })

  it('has no password persistence entry points in shipped source', () => {
    const findings: string[] = []
    for (const relative of sourceFiles) {
      const content = fs.readFileSync(path.join(root, relative), 'utf8')
      for (const token of forbidden) {
        if (content.includes(token)) findings.push(`${relative}: ${token}`)
      }
    }
    expect(findings).toEqual([])
  })

  it('does not grant plugins a credential-storage permission', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'plugins/full-connection-manager/package.json'), 'utf8'),
    )
    expect(manifest.omnitermPlugin.permissions).not.toContain('credentials')
  })
})
