import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { checkLoc } from '../check-loc.mjs'
import { IDE_MODULE_ROOTS, isIdeModulePath } from '../ide-modules.mjs'

test('IDE module roots are unique repo-relative paths', () => {
  assert.equal(new Set(IDE_MODULE_ROOTS).size, IDE_MODULE_ROOTS.length)
  for (const root of IDE_MODULE_ROOTS) {
    assert.ok(!root.startsWith('/') && !root.includes('..') && !root.includes('\\'), root)
  }
})

test('isIdeModulePath matches a root and its children but not siblings', () => {
  const roots = ['ui/ide/editor', 'crates/ide-core']
  assert.equal(isIdeModulePath('ui/ide/editor/a.ts', roots), true)
  assert.equal(isIdeModulePath('crates\\ide-core\\src\\lib.rs', roots), true)
  assert.equal(isIdeModulePath('ui/ide/editor-extra/a.ts', roots), false)
  assert.equal(isIdeModulePath('ui/components/a.tsx', roots), false)
})

test('checkLoc skips IDE module directories but still checks the rest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omniterm-loc-ide-'))
  await mkdir(path.join(root, 'ui', 'ide', 'editor'), { recursive: true })
  await mkdir(path.join(root, 'ui', 'own'), { recursive: true })
  await writeFile(path.join(root, 'ui', 'ide', 'editor', 'big.ts'), 'x\n'.repeat(5000))
  await writeFile(path.join(root, 'ui', 'own', 'big.ts'), 'x\n'.repeat(5000))

  const result = await checkLoc({ root, limits: { '.ts': 400 }, ideModuleRoots: ['ui/ide/editor'] })

  assert.deepEqual(result.violations.map((item) => item.path), ['ui/own/big.ts'])
})
