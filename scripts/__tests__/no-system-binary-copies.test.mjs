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
// A `#!/bin/sh` shebang in a script a test writes names an interpreter, it copies nothing.
const SYSTEM_BINARY = /SystemRoot|System32|(?<!#!)\/(?:usr\/)?bin\/(?:sleep|sh|bash|ping|cat)\b/i

/** Lines around a copy call searched for a system path: close enough to catch `let src = …System32…; fs::copy(src, …)`. */
const WINDOW = 15

/** Whether a system executable path sits within `WINDOW` lines of a copy call. */
function copiesSystemBinary(text) {
  const lines = text.split(/\r?\n/)
  return lines.some((line, index) => {
    if (!COPY.test(line)) return false
    const near = lines.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).join('\n')
    return SYSTEM_BINARY.test(near)
  })
}

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
    if (copiesSystemBinary(text)) offenders.push(path.relative(root, file))
  }
  assert.deepEqual(offenders, [], `tests copying system executables: ${offenders.join(', ')}`)
})

test('the system executable pattern ignores shebangs of scripts a test writes', () => {
  assert.equal(SYSTEM_BINARY.test('std::fs::write(&helper, "#!/bin/sh\ntouch x")'), false)
  assert.equal(SYSTEM_BINARY.test('fs::copy("/bin/sleep", &dst)'), true)
  assert.equal(SYSTEM_BINARY.test(String.raw`C:\Windows\System32\PING.EXE`), true)
  assert.equal(SYSTEM_BINARY.test('Command::new("/usr/bin/cat")'), true)
})

test('a copy call is flagged only with a system path close to it', () => {
  const filler = Array.from({ length: 40 }, (_, i) => `let x${i} = ${i};`).join('\n')
  assert.equal(copiesSystemBinary(String.raw`fs::copy(Path::new(r"C:\Windows\System32\PING.EXE"), &dst)`), true)
  assert.equal(copiesSystemBinary('let src = system_root.join("System32");\nlet y = 1;\nfs::copy(&src, &dst)'), true)
  // A shell named as a program far away from an unrelated directory copy is not a copy of it.
  assert.equal(copiesSystemBinary(`for p in ["/bin/bash"] {}\n${filler}\nstd::fs::copy(&src, &dst)`), false)
})
