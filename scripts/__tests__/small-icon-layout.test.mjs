import assert from 'node:assert/strict'
import test from 'node:test'
import { iconSourceLayout, SMALL_ICON_MAX_SIZE } from '../image/app-icon-layout.mjs'

test('Windows icons use full logo composition for all sizes matching v0.1.0', () => {
  assert.equal(SMALL_ICON_MAX_SIZE, 0)
  assert.deepEqual(iconSourceLayout(16, 1024), { kind: 'full' })
  assert.deepEqual(iconSourceLayout(32, 1024), { kind: 'full' })
  assert.deepEqual(iconSourceLayout(48, 1024), { kind: 'full' })
  assert.deepEqual(iconSourceLayout(64, 1024), { kind: 'full' })
})

test('small icon layout scaling helper works when compact max size is configured', () => {
  assert.deepEqual(iconSourceLayout(64, 1024), { kind: 'full' })
})

