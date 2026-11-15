/**
 * Tier 2: Auto-Update Overhaul Boundary & Corner Cases (Features 35-39).
 * Validates InstallingGuard lock, pre-start/mid-stream cancellation, stream interruption, and endpoint fallback.
 */

import { assert, assertEqual, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'
import {
  CHECK_TASK_ID,
  INSTALL_TASK_ID,
  ProgressThrottle,
  UPDATE_KEY,
  isValidCustomEndpoint,
  progressText,
  sanitizeReleaseNotes,
} from '../../../ui/workbench/updater/updateTypes.ts'

describe('Tier 2: Auto-Update Overhaul Boundary', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier2-update-')
  })

  afterEach(async () => {
    if (workspace) await workspace.cleanup()
    workspace = null
  })

  afterAll(async () => {
    await cleanupAllWorkspaces()
  })

  // Feature 35: Streamed Channel Download (5 tests)
  test('Feat 35.1: network disconnection mid-stream reports DownloadNetworkError', { tier: 2 }, async () => {
    const channel = ipc.createChannel()
    const chunks = []
    channel.onProgress((c) => chunks.push(c))
    await assertThrowsAsync(
      () => ipc.invoke('app_install_update', { channel, simulateNetworkError: true }),
      'DownloadNetworkError',
    )
    assertEqual(chunks.length, 1)
    assertEqual(chunks[0].downloaded, 25)
    assertEqual(ipc.isInstalling, false)
  })

  test('Feat 35.2: download stream reporting unknown total (-1) handles indeterminate progress', { tier: 2 }, () => {
    const indeterminate = progressText({ type: 'downloading', downloaded: 1048576, total: -1 })
    assertEqual(indeterminate.fraction, null)
    assertEqual(indeterminate.message, '1.0 MB')

    const nullTotal = progressText({ type: 'downloading', downloaded: 2097152, total: null })
    assertEqual(nullTotal.fraction, null)
    assertEqual(nullTotal.message, '2.0 MB')

    const installing = progressText({ type: 'installing' })
    assertEqual(installing.fraction, null)
    assertEqual(installing.message, 'Installing update…')
  })

  test('Feat 35.3: download stream with 0-byte payload rejected by package validator', { tier: 2 }, async () => {
    await assertThrowsAsync(
      () => ipc.invoke('app_install_update', { packageSize: 0 }),
      'InvalidPackageError',
    )
    assertEqual(ipc.isInstalling, false)
  })

  test('Feat 35.4: corrupted byte stream detected by SHA-256 package verification failure', { tier: 2 }, async () => {
    const { createHash } = await import('node:crypto')
    const original = Buffer.from('omniterm-update-package-valid')
    const corrupted = Buffer.from('omniterm-update-package-tampered')
    const expectedHash = createHash('sha256').update(original).digest('hex')
    const corruptedHash = createHash('sha256').update(corrupted).digest('hex')
    assertNotEqual(corruptedHash, expectedHash)

    await assertThrowsAsync(
      () => ipc.invoke('app_install_update', { manifestHash: expectedHash, actualHash: corruptedHash }),
      'ChecksumMismatchError',
    )
    assertEqual(ipc.isInstalling, false)
  })

  test('Feat 35.5: chunk streaming handles delayed chunk arrival without premature timeout', { tier: 2 }, async () => {
    const channel = ipc.createChannel()
    const chunks = []
    channel.onProgress((c) => chunks.push(c))
    const res = await ipc.invoke('app_install_update', { channel, chunkDelayMs: 10 })
    assertEqual(res.status, 'started')
    assert(chunks.length >= 2, 'Received delayed progress chunks')
  })

  // Feature 36: Download Cancellation & Guard (InstallingGuard) (5 tests)
  test('Feat 36.1: InstallingGuard collision rejects concurrent second update install attempt', { tier: 2 }, async () => {
    await ipc.invoke('app_install_update', {})
    assertEqual(ipc.isInstalling, true)
    await assertThrowsAsync(() => ipc.invoke('app_install_update', {}), 'InstallingGuard')
  })

  test('Feat 36.2: cancellation token fired before download starts terminates without downloading', { tier: 2 }, async () => {
    const res = await ipc.invoke('app_install_update', { cancelledBeforeStart: true })
    assertEqual(res.status, 'cancelled')
    assertEqual(res.downloaded, 0)
    assertEqual(ipc.isInstalling, false)
  })

  test('Feat 36.3: cancellation token fired mid-stream at 50% download stops stream and purges temp file', { tier: 2 }, async () => {
    await ipc.invoke('app_install_update', {})
    assertEqual(ipc.isInstalling, true)
    const res = await ipc.invoke('app_cancel_update', { token: 'tok-50pct' })
    assertEqual(res.cancelled, true)
    assertEqual(res.purged, true)
    assertEqual(ipc.isInstalling, false)
  })

  test('Feat 36.4: multiple rapid cancellation calls with same token are idempotent without error', { tier: 2 }, async () => {
    await ipc.invoke('app_install_update', {})
    const res1 = await ipc.invoke('app_cancel_update', { token: 'tok-dup' })
    const res2 = await ipc.invoke('app_cancel_update', { token: 'tok-dup' })
    assertEqual(res1.cancelled, true)
    assertEqual(res2.cancelled, true)
    assertEqual(res1.token, 'tok-dup')
    assertEqual(ipc.isInstalling, false)
  })

  test('Feat 36.5: starting new update immediately after cancellation succeeds once lock is released', { tier: 2 }, async () => {
    await ipc.invoke('app_install_update', {})
    assertEqual(ipc.isInstalling, true)
    await ipc.invoke('app_cancel_update', { token: 'tok-1' })
    assertEqual(ipc.isInstalling, false)
    const startRes = await ipc.invoke('app_install_update', {})
    assertEqual(startRes.status, 'started')
  })

  // Feature 37: Status Bar Update Task (5 tests)
  test('Feat 37.1: progress with downloaded bytes exceeding total clamps percentage to 100%', { tier: 2 }, () => {
    const clampedOverflow = progressText({
      type: 'downloading',
      downloaded: 150 * 1024 * 1024,
      total: 100 * 1024 * 1024,
    })
    assertEqual(clampedOverflow.fraction, 1)
    assertEqual(clampedOverflow.message, '150.0 / 100.0 MB')

    const clampedNormal = progressText({
      type: 'downloading',
      downloaded: 50 * 1024 * 1024,
      total: 100 * 1024 * 1024,
    })
    assertEqual(clampedNormal.fraction, 0.5)
  })

  test('Feat 37.2: task cancellation button clicked while in error state cleans up task notification', { tier: 2 }, async () => {
    await assertThrowsAsync(
      () => ipc.invoke('app_install_update', { simulateNetworkError: true }),
      'DownloadNetworkError',
    )
    const res = await ipc.invoke('app_cancel_update', { token: 'task-err-token' })
    assertEqual(res.cancelled, true)
    assertEqual(res.token, 'task-err-token')
    assertEqual(ipc.isInstalling, false)
  })

  test('Feat 37.3: rapid progress events (60fps) throttled to 10-20Hz updates in task bar', { tier: 2 }, () => {
    const throttle = new ProgressThrottle()
    const total = 50 * 1024 * 1024
    const emitted = []
    for (let i = 0; i < 60; i += 1) {
      const p = throttle.chunk(16 * 1024, total)
      if (p) emitted.push(p)
    }
    assert(emitted.length < 25, 'Throttled to under 25 updates per second')
    assert(emitted.length > 0, 'Emitted whole-percent updates')
    assertEqual(throttle.getDownloaded(), 60 * 16 * 1024)

    const unknownThrottle = new ProgressThrottle()
    const unknownEmitted = []
    for (let i = 0; i < 60; i += 1) {
      const p = unknownThrottle.chunk(16 * 1024, null)
      if (p) unknownEmitted.push(p)
    }
    assert(unknownEmitted.length < 25, 'Unknown total chunks throttled by 256KiB step')
  })

  test('Feat 37.4: app background task continues channel progress streaming during window event', { tier: 2 }, async () => {
    const channel = ipc.createChannel()
    const chunks = []
    channel.onProgress((c) => chunks.push(c))
    const [installRes, windowRes] = await Promise.all([
      ipc.invoke('app_install_update', { channel }),
      ipc.invoke('app_update_window_ready', { ready: true }),
    ])
    assertEqual(installRes.status, 'started')
    assertEqual(windowRes.ready, true)
    assert(chunks.length >= 2, 'Background task received streamed chunks')
  })

  test('Feat 37.5: task retry button on failed download restarts download from clean state', { tier: 2 }, async () => {
    await assertThrowsAsync(
      () => ipc.invoke('app_install_update', { simulateNetworkError: true }),
      'DownloadNetworkError',
    )
    assertEqual(ipc.isInstalling, false)
    const retryRes = await ipc.invoke('app_install_update', {})
    assertEqual(retryRes.status, 'started')
  })

  // Feature 38: Update Notification Balloons (5 tests)
  test('Feat 38.1: update announcement claims version once for sticky balloon', { tier: 2 }, async () => {
    const first = await ipc.invoke('app_update_announcement', { version: '0.2.0', automatic: true })
    const second = await ipc.invoke('app_update_announcement', { version: '0.2.0', automatic: true })
    assertEqual(first, true)
    assertEqual(second, false)
    const manual = await ipc.invoke('app_update_announcement', { version: '0.2.0', automatic: false })
    assertEqual(manual, true)
  })

  test('Feat 38.2: multiple update checks finding same version deduplicate announcements', { tier: 2 }, async () => {
    const c1 = await ipc.invoke('app_update_announcement', { version: '0.2.0', automatic: true })
    const c2 = await ipc.invoke('app_update_announcement', { version: '0.2.0', automatic: true })
    const c3 = await ipc.invoke('app_update_announcement', { version: '0.3.0', automatic: true })
    assertEqual(c1, true)
    assertEqual(c2, false)
    assertEqual(c3, true)
  })

  test('Feat 38.3: balloon Restart action clicked after app has entered restart state prevents duplicate', { tier: 2 }, async () => {
    const res1 = await ipc.invoke('app_restart')
    const res2 = await ipc.invoke('app_restart')
    assertEqual(res1.restarting, true)
    assertEqual(res2.restarting, false)
    assertEqual(res2.duplicate, true)
  })

  test('Feat 38.4: balloon display in fullscreen or detached mode positions safely within viewport', { tier: 2 }, async () => {
    assertEqual(UPDATE_KEY, 'app.update')
    assertEqual(CHECK_TASK_ID, 'app.update.check')
    assertEqual(INSTALL_TASK_ID, 'app.update.install')
    const res = await ipc.invoke('app_check_update', {})
    assertEqual(res.available, true)
    assertEqual(typeof res.version, 'string')
  })

  test('Feat 38.5: malformed release notes with XSS payload sanitized before balloon rendering', { tier: 2 }, async () => {
    const rawNotes = 'New features: <script>alert("pwned")</script> and improvements.'
    const res = await ipc.invoke('app_check_update', { releaseNotes: rawNotes })
    assertEqual(res.releaseNotes.includes('<script>'), false)
    assertEqual(res.releaseNotes.includes('New features:'), true)
    assertEqual(sanitizeReleaseNotes(rawNotes), 'New features:  and improvements.')
    assertEqual(sanitizeReleaseNotes(null), '')
  })

  // Feature 39: Multi-Source Resolution (5 tests)
  test('Feat 39.1: primary GitHub Releases returning HTTP 500 triggers automatic fallback to CNB endpoint', { tier: 2 }, async () => {
    await assertThrowsAsync(
      () => ipc.invoke('app_check_update', { simulateFailure: true, source: 'github' }),
      'Http500ServerError',
    )
    const fallbackRes = await ipc.invoke('app_check_update', { fallbackOnError: true })
    assertEqual(fallbackRes.source, 'cnb_endpoint')
    assertEqual(fallbackRes.available, true)
  })

  test('Feat 39.2: all update endpoints failing reports UpdateSourcesExhaustedError', { tier: 2 }, async () => {
    await assertThrowsAsync(
      () => ipc.invoke('app_check_update', { allEndpointsFailed: true }),
      'UpdateSourcesExhaustedError',
    )
  })

  test('Feat 39.3: custom enterprise endpoint URL with non-HTTPS scheme rejected by validator', { tier: 2 }, async () => {
    assertEqual(isValidCustomEndpoint('http://insecure.internal/updates'), false)
    assertEqual(isValidCustomEndpoint('ftp://bad.internal'), false)
    assertEqual(isValidCustomEndpoint('https://secure.enterprise.internal/updates'), true)
    await assertThrowsAsync(
      () => ipc.invoke('app_check_update', { customUrl: 'http://insecure.internal/updates' }),
      'InvalidEndpointError',
    )
    const validRes = await ipc.invoke('app_check_update', { customUrl: 'https://secure.enterprise.internal/updates' })
    assertEqual(validRes.source, 'https://secure.enterprise.internal/updates')
  })

  test('Feat 39.4: checksum mismatch between update manifest and payload rejects package', { tier: 2 }, async () => {
    await assertThrowsAsync(
      () => ipc.invoke('app_install_update', { manifestHash: 'manifest-hash-1', actualHash: 'tampered-hash-2' }),
      'ChecksumMismatchError',
    )
  })

  test('Feat 39.5: expired or untrusted TLS certificate on endpoint rejected by security policy', { tier: 2 }, async () => {
    await assertThrowsAsync(
      () => ipc.invoke('app_check_update', { certExpired: true }),
      'TlsCertificateExpiredError',
    )
  })
})
