import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'contract/index.ts',
  'ui/omnitermAPI.ts',
  'ui/vite-env.d.ts',
  'ui/components/ConnectionForm.tsx',
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
const findings = []
if (fs.existsSync(path.join(root, 'src-tauri/src/credential_vault.rs'))) {
  findings.push('src-tauri/src/credential_vault.rs still exists')
}
for (const relative of files) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8')
  for (const token of forbidden) {
    if (content.includes(token)) findings.push(`${relative}: ${token}`)
  }
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins/full-connection-manager/package.json'), 'utf8'))
if (manifest.omnitermPlugin?.permissions?.includes('credentials')) {
  findings.push('Full Remote Suite still requests credentials permission')
}

const permissionFiles = [
  'contract/index.ts',
  'scripts/plugin-paths.mjs',
  'src-tauri/sidecar/host-api.cjs',
  'plugins/full-connection-manager/src/types.ts',
  'plugins/native-batch-connections/src/types.ts',
]
for (const relative of permissionFiles) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8')
  if (/["']credentials["']/.test(content)) {
    findings.push(`${relative}: credential-storage permission still declared`)
  }
}
const rustPermissions = fs.readFileSync(
  path.join(root, 'src-tauri/src/plugin_management.rs'),
  'utf8',
).split('#[cfg(test)]')[0]
if (/["']credentials["']/.test(rustPermissions)) {
  findings.push('src-tauri/src/plugin_management.rs: credential-storage permission still declared')
}

for (const relative of [
  'ui/hooks/useConnectionMeta.ts',
  'ui/components/MainLayout.tsx',
  'ui/components/WorkspacePanel.tsx',
]) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8')
  if (content.includes('localStorage') && /password|credential|secret/i.test(content)) {
    findings.push(`${relative}: localStorage file contains credential-related logic`)
  }
}

if (findings.length) {
  console.error(findings.join('\n'))
  process.exit(1)
}
console.log('No password-persistence entry points found.')
