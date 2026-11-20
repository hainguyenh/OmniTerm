/**
 * Baseline Smoke Test Suite for OmniTerm IDE E2E Test Runner & Harness.
 * Validates test runner execution, mock IPC dispatch, event bus, fixture sandbox, and assertions.
 */

import {
  assert,
  assertDeepEqual,
  assertEqual,
  assertEventReceived,
  assertMatchesPattern,
  assertNotEqual,
  assertThrowsAsync,
  assertWithinRange,
} from './helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from './helpers/fixtures.mjs'
import { createMockIpc } from './helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, it, test } from './runner/framework.mjs'

describe('M1 E2E Test Infrastructure Baseline Smoke', () => {
  let ipc
  let workspace
  let lifecycleCount = 0

  beforeEach(async () => {
    ipc = createMockIpc()
    lifecycleCount++
  })

  afterEach(async () => {
    if (workspace) {
      await workspace.cleanup()
      workspace = null
    }
  })

  afterAll(async () => {
    await cleanupAllWorkspaces()
  })

  test('Runner executes test cases and tracks lifecycle hooks', () => {
    assert(lifecycleCount >= 1, 'beforeEach hook must have executed before test')
    assertEqual(typeof describe, 'function')
    assertEqual(typeof it, 'function')
  }, { tier: 1 })

  test('Mock IPC dispatches IDE document commands and tracks call history', async () => {
    const openResult = await ipc.invoke('doc_open', {
      path: '/workspace/src/main.rs',
      initialText: 'fn main() {}',
    })

    assertEqual(openResult.path, '/workspace/src/main.rs')
    assertEqual(openResult.language, 'rust')
    assertEqual(openResult.version, 1)

    const editResult = await ipc.invoke('doc_edit', {
      id: openResult.id,
      version: openResult.version,
      edits: [{ range: [0, 0], text: '// header\n' }],
    })

    assertEqual(editResult.version, 2)

    ipc.assertCalled('doc_open', 1)
    ipc.assertCalled('doc_edit', 1)
    ipc.assertNotCalled('doc_close')
  }, { tier: 1 })

  test('Mock IPC event bus emits and receives ide://event', async () => {
    const eventPromise = assertEventReceived(ipc, 'ide://event', 1000, (payload) => payload.type === 'fsChanged')

    ipc.emit('ide://event', {
      type: 'fsChanged',
      path: '/workspace/src/lib.rs',
      kind: 'modify',
    })

    const received = await eventPromise
    assertEqual(received.type, 'fsChanged')
    assertEqual(received.path, '/workspace/src/lib.rs')
  }, { tier: 1 })

  test('Mock IPC channel streams download and progress updates', async () => {
    const channel = ipc.createChannel()
    const progressChunks = []

    channel.onProgress((data) => {
      progressChunks.push(data)
    })

    await ipc.invoke('app_install_update', { channel })

    assertEqual(progressChunks.length, 3)
    assertDeepEqual(progressChunks[0], { state: 'downloading', downloaded: 50, total: 100 })
    assertDeepEqual(progressChunks[1], { state: 'downloading', downloaded: 100, total: 100 })
    assertDeepEqual(progressChunks[2], { state: 'ready' })
  }, { tier: 1 })

  test('Sandboxed workspace fixture creates files, directories, and cleans up cleanly', async () => {
    workspace = await createTempWorkspace('smoke-test-')
    assert(workspace.exists('.'), 'Workspace root must exist')

    const filePath = await workspace.writeFile('src/config.json', '{"debug": true}')
    assert(workspace.exists('src/config.json'), 'Created file must exist on disk')

    const content = await workspace.readFile('src/config.json')
    assertEqual(content, '{"debug": true}')

    await workspace.cleanup()
    assert(!workspace.exists('.'), 'Cleaned up workspace root must no longer exist')
    workspace = null
  }, { tier: 1 })

  test('Assertion library handles value checks, pattern matching, ranges, and exceptions', async () => {
    assertEqual(42, 42)
    assertNotEqual(42, 100)
    assertMatchesPattern('OmniTerm IDE Port', /^OmniTerm/)
    assertWithinRange(25, 10, 50)

    await assertThrowsAsync(
      async () => {
        await ipc.invoke('non_existent_command', {})
      },
      "Command 'non_existent_command' not registered",
      'Should throw for unregistered commands',
    )
  }, { tier: 1 })

  test('Tier 2 boundary handling: empty payloads and missing arguments', async () => {
    const openEmpty = await ipc.invoke('doc_open', {})
    assertEqual(openEmpty.path, '')
    assertEqual(openEmpty.language, 'plaintext')

    const deleteEmpty = await ipc.invoke('fs_delete', {})
    assertEqual(deleteEmpty.deleted, true)
  }, { tier: 2 })
})
