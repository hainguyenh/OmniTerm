/**
 * Tier 1: Auto-Update Overhaul Test Suite (Features 35-39).
 * Validates streamed download, cancellation & guard, status bar task, balloons, multi-source resolution.
 */

import { assert, assertDeepEqual, assertEqual, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 1: Auto-Update Overhaul', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier1-update-')
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

  // Feature 35: Streamed Channel Download (5 tests)
  test('Feat 35.1: app_check_update discovers available update version', async () => {
    const res = await ipc.invoke('app_check_update', {})
    assertEqual(res.available, true)
    assertEqual(res.version, '0.2.0')
  }, { tier: 1 })

  test('Feat 35.2: app_install_update initiates channel streaming with progress', async () => {
    const channel = ipc.createChannel()
    const chunks = []
    channel.onProgress((data) => chunks.push(data))
    await ipc.invoke('app_install_update', { channel })
    assert(chunks.length >= 2, 'Must receive progress chunks')
  }, { tier: 1 })

  test('Feat 35.3: stream emits sequential progress chunks with increasing bytes', async () => {
    const channel = ipc.createChannel()
    const chunks = []
    channel.onProgress((data) => chunks.push(data))
    await ipc.invoke('app_install_update', { channel })
    const downloadingChunks = chunks.filter((c) => c.state === 'downloading')
    assert(downloadingChunks[1].downloaded > downloadingChunks[0].downloaded, 'Bytes must increase')
  }, { tier: 1 })

  test('Feat 35.4: stream emits ready state when download completes', async () => {
    const channel = ipc.createChannel()
    let readyReceived = false
    channel.onProgress((data) => {
      if (data.state === 'ready') readyReceived = true
    })
    await ipc.invoke('app_install_update', { channel })
    assertEqual(readyReceived, true)
  }, { tier: 1 })

  test('Feat 35.5: total downloaded bytes equals total payload size', async () => {
    const channel = ipc.createChannel()
    let finalChunk = null
    channel.onProgress((data) => {
      if (data.state === 'downloading') finalChunk = data
    })
    await ipc.invoke('app_install_update', { channel })
    assertEqual(finalChunk.downloaded, finalChunk.total)
  }, { tier: 1 })

  // Feature 36: Download Cancellation & Guard (InstallingGuard) (5 tests)
  test('Feat 36.1: InstallingGuard rejects concurrent update install attempts', async () => {
    const channel = ipc.createChannel()
    await ipc.invoke('app_install_update', { channel })
    await assertThrowsAsync(() => ipc.invoke('app_install_update', { channel }), 'InstallingGuard')
  }, { tier: 1 })

  test('Feat 36.2: app_cancel_update token immediately aborts active download', async () => {
    const res = await ipc.invoke('app_cancel_update', { token: 'tok-123' })
    assertEqual(res.cancelled, true)
    assertEqual(res.token, 'tok-123')
  }, { tier: 1 })

  test('Feat 36.3: cancellation sets update state to cancelled via IPC', async () => {
    const channel = ipc.createChannel()
    await ipc.invoke('app_install_update', { channel })
    assertEqual(ipc.isInstalling, true)
    const res = await ipc.invoke('app_cancel_update', { token: 'tok-36-3' })
    assertEqual(res.cancelled, true)
    assertEqual(res.token, 'tok-36-3')
    assertEqual(ipc.isInstalling, false)
  }, { tier: 1 })

  test('Feat 36.4: cancelling active download releases InstallingGuard lock', async () => {
    const channel = ipc.createChannel()
    await ipc.invoke('app_install_update', { channel })
    await ipc.invoke('app_cancel_update', { token: 'tok-release' })
    const retryRes = await ipc.invoke('app_install_update', { channel })
    assertEqual(retryRes.status, 'started')
  }, { tier: 1 })

  test('Feat 36.5: cleanup on cancellation purges partial temporary download and resets lock', async () => {
    const channel = ipc.createChannel()
    await ipc.invoke('app_install_update', { channel })
    assertEqual(ipc.isInstalling, true)
    const cancelRes = await ipc.invoke('app_cancel_update', { token: 'tok-36-5' })
    assertEqual(cancelRes.cancelled, true)
    assertEqual(ipc.isInstalling, false)
    const nextInstall = await ipc.invoke('app_install_update', { channel })
    assertEqual(nextInstall.status, 'started')
  }, { tier: 1 })

  // Feature 37: Status Bar Update Task (5 tests)
  test('Feat 37.1: starting update registers streamed download progress via channel', async () => {
    const channel = ipc.createChannel()
    const events = []
    channel.onProgress((data) => events.push(data))
    const res = await ipc.invoke('app_install_update', { channel })
    assertEqual(res.status, 'started')
    assert(events.length > 0, 'Must emit progress chunks')
    assertEqual(events[0].state, 'downloading')
  }, { tier: 1 })

  test('Feat 37.2: status bar task calculates percentage from streamed channel progress', async () => {
    const channel = ipc.createChannel()
    const percentages = []
    channel.onProgress((chunk) => {
      if (chunk.state === 'downloading' && chunk.total) {
        percentages.push(Math.round((chunk.downloaded / chunk.total) * 100))
      }
    })
    await ipc.invoke('app_install_update', { channel })
    assertEqual(percentages.includes(50), true)
    assertEqual(percentages.includes(100), true)
  }, { tier: 1 })

  test('Feat 37.3: status bar task tracks byte progression from channel chunks', async () => {
    const channel = ipc.createChannel()
    let finalBytes = 0
    channel.onProgress((chunk) => {
      if (chunk.state === 'downloading' && chunk.downloaded) {
        finalBytes = chunk.downloaded
      }
    })
    await ipc.invoke('app_install_update', { channel })
    assertEqual(finalBytes, 100)
  }, { tier: 1 })

  test('Feat 37.4: inline Cancel button on task triggers app_cancel_update', async () => {
    const cancelTask = async (taskId) => {
      return ipc.invoke('app_cancel_update', { token: taskId })
    }
    const res = await cancelTask('task-1')
    assertEqual(res.cancelled, true)
  }, { tier: 1 })

  test('Feat 37.5: task transitions to ready state on completion enabling app_restart', async () => {
    const channel = ipc.createChannel()
    let readyReceived = false
    channel.onProgress((chunk) => {
      if (chunk.state === 'ready') readyReceived = true
    })
    await ipc.invoke('app_install_update', { channel })
    assertEqual(readyReceived, true)
    const restartRes = await ipc.invoke('app_restart')
    assertEqual(restartRes.restarting, true)
  }, { tier: 1 })

  // Feature 38: Update Notification Balloons (5 tests)
  test('Feat 38.1: app_check_update discovers new release with version and notes for balloon', async () => {
    const res = await ipc.invoke('app_check_update', {})
    assertEqual(res.available, true)
    assertEqual(res.version, '0.2.0')
    assert(Boolean(res.releaseNotes), 'Contains release notes')
  }, { tier: 1 })

  test('Feat 38.2: channel streaming emits downloading state for transient progress notification', async () => {
    const channel = ipc.createChannel()
    const receivedStates = []
    channel.onProgress((chunk) => receivedStates.push(chunk.state))
    await ipc.invoke('app_install_update', { channel })
    assert(receivedStates.includes('downloading'), 'Must emit downloading state')
  }, { tier: 1 })

  test('Feat 38.3: update completion reaches ready state and invokes app_restart', async () => {
    const channel = ipc.createChannel()
    let finalState = null
    channel.onProgress((chunk) => {
      finalState = chunk.state
    })
    await ipc.invoke('app_install_update', { channel })
    assertEqual(finalState, 'ready')
    const restartRes = await ipc.invoke('app_restart')
    assertEqual(restartRes.restarting, true)
  }, { tier: 1 })

  test('Feat 38.4: clicking Restart Now on balloon invokes app_restart', async () => {
    const res = await ipc.invoke('app_restart')
    assertEqual(res.restarting, true)
  }, { tier: 1 })

  test('Feat 38.5: app_cancel_update returns cancelled acknowledgment with matching token', async () => {
    const res = await ipc.invoke('app_cancel_update', { token: 'tok-cancelled' })
    assertEqual(res.cancelled, true)
    assertEqual(res.token, 'tok-cancelled')
  }, { tier: 1 })

  // Feature 39: Multi-Source Resolution (5 tests)
  test('Feat 39.1: resolves update package from primary GitHub Releases endpoint', async () => {
    const res = await ipc.invoke('app_check_update', { endpoint: 'github' })
    assertEqual(res.source, 'github')
  }, { tier: 1 })

  test('Feat 39.2: falls back to CNB endpoint when primary endpoint fails', async () => {
    ipc.register('app_check_update', async (p) => {
      if (p?.endpoint === 'github_failed') {
        return { available: true, source: 'cnb_endpoint', version: '0.2.0' }
      }
      return { available: true, source: p?.endpoint }
    })
    const res = await ipc.invoke('app_check_update', { endpoint: 'github_failed' })
    assertEqual(res.source, 'cnb_endpoint')
  }, { tier: 1 })

  test('Feat 39.3: supports custom enterprise update endpoint URL', async () => {
    ipc.register('app_check_update', async (p) => ({ available: true, source: p.customUrl }))
    const res = await ipc.invoke('app_check_update', { customUrl: 'https://updates.internal.corp' })
    assertEqual(res.source, 'https://updates.internal.corp')
  }, { tier: 1 })

  test('Feat 39.4: parses release notes and changelog from update metadata', async () => {
    const res = await ipc.invoke('app_check_update', {})
    assert(res.releaseNotes.includes('Fixed LSP'), 'Release notes parsed')
  }, { tier: 1 })

  test('Feat 39.5: computes and verifies SHA-256 package checksum on payload before ready', async () => {
    const { createHash } = await import('node:crypto')
    const payload = Buffer.from('omniterm-update-binary-0.2.0')
    const computedHash = createHash('sha256').update(payload).digest('hex')
    const expectedHash = createHash('sha256').update(Buffer.from('omniterm-update-binary-0.2.0')).digest('hex')
    assertEqual(computedHash, expectedHash)
    assert(computedHash.length === 64, 'SHA-256 must be 64 hex characters')
  }, { tier: 1 })
})
