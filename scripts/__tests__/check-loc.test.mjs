import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { checkLoc, countLines, DEFAULT_LIMITS } from '../check-loc.mjs'

test('countLines counts physical lines without inventing a trailing line', () => {
  assert.equal(countLines('one\ntwo\n'), 2)
  assert.equal(countLines('one\ntwo'), 2)
  assert.equal(countLines(''), 0)
})

test('default limits match the repository policy exactly', () => {
  assert.deepEqual(DEFAULT_LIMITS, {
    '.ts': 400,
    '.tsx': 500,
    '.js': 350,
    '.css': 600,
    '.rs': 400,
  })
})

test('checkLoc rejects a file one physical line over its extension limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omniterm-loc-'))
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'ok.ts'), 'x\n'.repeat(400))
  await writeFile(path.join(root, 'src', 'too-long.ts'), 'x\n'.repeat(401))

  const result = await checkLoc({ root, limits: { '.ts': 400 } })

  assert.deepEqual(result.violations.map((item) => item.path), ['src/too-long.ts'])
  assert.equal(result.violations[0].lines, 401)
  assert.equal(result.violations[0].limit, 400)
})

test('checkLoc has no legacy-baseline escape hatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omniterm-loc-'))
  await writeFile(path.join(root, 'legacy.tsx'), 'x\n'.repeat(501))

  const result = await checkLoc({ root, limits: { '.tsx': 500 } })

  assert.equal(Object.hasOwn(result, 'baselineFiles'), false)
  assert.deepEqual(result.violations.map((item) => item.path), ['legacy.tsx'])
})

test('repository satisfies every configured LOC hard limit', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const result = await checkLoc({ root })

  assert.deepEqual(result.violations, [])
})
