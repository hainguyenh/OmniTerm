import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Tests must never copy a system executable, least of all under a new name: a test binary that
 * copies `System32\PING.EXE` to `%TEMP%\claude.exe` and runs it is indistinguishable from malware
 * masquerading, and Windows Defender quarantined exactly that (Trojan:Win32/Bearfoos.B!ml).
 * Tests that need an agent use recorded process rows instead.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IGNORED = new Set(['.git', 'node_modules', 'target', 'dist', 'coverage-js', 'coverage-rust', 'markdown-explorer', '.omniterm-build', 'artifacts'])
const COPY = /\b(?:fs::copy|copyFileSync|copyFile|cpSync)\s*\(/
const SYSTEM_BINARY = /SystemRoot|System32|\/(?:usr\/)?bin\/(?:sleep|sh|bash|ping|cat)\b/i

const isTestFile = (file) =>
  /_tests?\.rs$/.test(file) || /\.test\.(?:ts|tsx|mjs|js)$/.test(file) || /[\\/](?:__tests__|tests)[\\/]/.test(file)

async function* sources(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(full)
    else if (/\.(?:rs|ts|tsx|mjs|js)$/.test(entry.name)) yield full
  }
}

test('no test copies a system executable', async () => {
  const offenders = []
  for await (const file of sources(root)) {
    if (!isTestFile(file) || file.endsWith('no-system-binary-copies.test.mjs')) continue
    const text = await readFile(file, 'utf8')
    if (COPY.test(text) && SYSTEM_BINARY.test(text)) offenders.push(path.relative(root, file))
  }
  assert.deepEqual(offenders, [], `tests copying system executables: ${offenders.join(', ')}`)
})
