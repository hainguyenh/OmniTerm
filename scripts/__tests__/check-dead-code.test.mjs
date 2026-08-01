import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { findOrphanModules } from '../check-dead-code.mjs'

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-dead-code-'))
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return root
}

test('findOrphanModules follows static, re-export, dynamic, and index imports', () => {
  const root = fixture({
    'src/main.tsx': "import './feature'; export { value } from './shared'",
    'src/feature/index.ts': "void import('../lazy')",
    'src/lazy.ts': 'export const lazy = true',
    'src/shared.ts': 'export const value = 1',
  })
  try {
    assert.deepEqual(findOrphanModules({ root, sourceRoots: ['src'], entrypoints: ['src/main.tsx'] }), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('findOrphanModules reports production files with no importer', () => {
  const root = fixture({
    'src/main.tsx': "import './used'",
    'src/used.ts': 'export const used = true',
    'src/dead.tsx': 'export default function Dead() { return null }',
    'src/ignored.test.ts': "import './dead'",
  })
  try {
    assert.deepEqual(
      findOrphanModules({ root, sourceRoots: ['src'], entrypoints: ['src/main.tsx'] }),
      ['src/dead.tsx'],
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
