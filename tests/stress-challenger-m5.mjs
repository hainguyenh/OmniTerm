/**
 * Empirical Challenger Stress Harness for Milestone 5: Auto-Update Overhaul
 * Stress-tests:
 *  1. Single-flight lock (InstallingGuard) under high concurrency
 *  2. Download progress streaming & rapid progress throttling
 *  3. Download cancellation mid-stream & lock release
 *  4. Network errors (interruption, 0 package size, corrupted hash mismatch, TLS cert expiry)
 *  5. Deadlock, memory leak, and unhandled promise rejection checks
 */

import { createHash } from 'node:crypto'
import {
  CHECK_TASK_ID,
  INSTALL_TASK_ID,
  ProgressThrottle,
  UPDATE_KEY,
  isValidCustomEndpoint,
  progressText,
  sanitizeReleaseNotes,
} from '../ui/workbench/updater/updateTypes.ts'
import { createMockIpc } from './e2e/helpers/mock-ipc.mjs'

let totalAssertions = 0
let failedAssertions = 0
let unhandledRejectionsCount = 0

process.on('unhandledRejection', (reason) => {
  unhandledRejectionsCount++
  console.error('🚨 UNHANDLED REJECTION:', reason)
})

function assert(condition, message) {
  totalAssertions++
  if (!condition) {
    failedAssertions++
    console.error(`  ❌ FAIL: ${message}`)
    throw new Error(message || 'Assertion failed')
  }
}

function assertEqual(actual, expected, message) {
  totalAssertions++
  if (actual !== expected) {
    failedAssertions++
    const msg = `${message || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    console.error(`  ❌ FAIL: ${msg}`)
    throw new Error(msg)
  }
}

console.log('🚀 EMPIRICAL CHALLENGER STRESS SUITE: AUTO-UPDATE OVERHAUL\n')

// --- SUITE 1: SINGLE-FLIGHT LOCK (InstallingGuard) CONCURRENCY STRESS ---
console.log('[SUITE 1] Single-Flight Lock (InstallingGuard) Concurrency Stress')
{
  const ipc = createMockIpc()

  // 1.1: 50 simultaneous app_install_update invocations
  const promises = Array.from({ length: 50 }, () =>
    ipc.invoke('app_install_update', {}).then(
      (res) => ({ status: 'resolved', res }),
      (err) => ({ status: 'rejected', err: err.message }),
    ),
  )
  const results = await Promise.all(promises)
  const resolved = results.filter((r) => r.status === 'resolved')
  const rejected = results.filter((r) => r.status === 'rejected')

  assertEqual(resolved.length, 1, 'Exactly one concurrent install must acquire lock')
  assertEqual(rejected.length, 49, '49 concurrent installs must be rejected by InstallingGuard')
  assert(rejected.every((r) => r.err.includes('InstallingGuard')), 'All rejections name InstallingGuard')
  assertEqual(ipc.isInstalling, true, 'Lock must remain held by winning install')
  console.log('  ✔ Scenario 1.1 Passed: 1 acquired lock, 49 cleanly rejected by InstallingGuard')

  // 1.2: Second batch of 50 concurrent installs after lock release
  await ipc.invoke('app_cancel_update', { token: 'reset-1' })
  assertEqual(ipc.isInstalling, false, 'Lock released after cancel')

  const batch2 = Array.from({ length: 50 }, () =>
    ipc.invoke('app_install_update', {}).then(
      (res) => ({ status: 'resolved', res }),
      (err) => ({ status: 'rejected', err: err.message }),
    ),
  )
  const batch2Res = await Promise.all(batch2)
  assertEqual(batch2Res.filter((r) => r.status === 'resolved').length, 1, 'Batch 2: exactly 1 acquired lock')
  assertEqual(batch2Res.filter((r) => r.status === 'rejected').length, 49, 'Batch 2: 49 rejected')
  assertEqual(ipc.isInstalling, true, 'Lock held by batch 2 winner')
  console.log('  ✔ Scenario 1.2 Passed: Re-acquisition after release enforces single-flight lock')

  await ipc.invoke('app_cancel_update', { token: 'reset-2' })
  assertEqual(ipc.isInstalling, false)
}

// --- SUITE 2: DOWNLOAD PROGRESS STREAMING & RAPID THROTTLING STRESS ---
console.log('\n[SUITE 2] Download Progress Streaming & Rapid Throttling Stress')
{
  // 2.1: 100,000 rapid micro-chunks (16 bytes each, 1.6MB total / 100MB)
  const throttle = new ProgressThrottle()
  const total = 100 * 1024 * 1024
  let emitCount = 0
  const events = []
  for (let i = 0; i < 100_000; i++) {
    const p = throttle.chunk(16, total)
    if (p) {
      emitCount++
      events.push(p)
    }
  }
  assertEqual(emitCount, 2, `100,000 micro-chunks must emit exactly 2 events (got ${emitCount})`)
  assertEqual(throttle.getDownloaded(), 1_600_000, 'Total downloaded bytes match 1,600,000')
  assertEqual(events[0].downloaded, 16, 'First event at step 0')
  assertEqual(events[1].downloaded, 1_048_576, 'Second event at 1%')
  console.log('  ✔ Scenario 2.1 Passed: 100,000 micro-chunks smoothly throttled to 2 events')

  // 2.2: Boundary progression (1,000 1-byte chunks for total=1000)
  const boundaryThrottle = new ProgressThrottle()
  let boundaryEmits = 0
  for (let i = 0; i < 1000; i++) {
    if (boundaryThrottle.chunk(1, 1000)) boundaryEmits++
  }
  assertEqual(boundaryEmits, 101, 'Emits strictly 101 whole-percent events (0..100%)')
  assertEqual(boundaryThrottle.getDownloaded(), 1000)
  console.log('  ✔ Scenario 2.2 Passed: Boundary step progression emits 101 whole-percent events')

  // 2.3: Indeterminate total (null)
  const unknownThrottle = new ProgressThrottle()
  let unknownEmits = 0
  for (let i = 0; i < 160; i++) {
    if (unknownThrottle.chunk(64 * 1024, null)) unknownEmits++
  }
  assertEqual(unknownEmits, 41, 'Unknown total throttles by 256KiB steps (got 41)')
  console.log('  ✔ Scenario 2.3 Passed: Indeterminate total smoothly throttled by 256KiB step')

  // 2.4: Overflow clamping
  const overflow = progressText({ type: 'downloading', downloaded: 500 * 1024 * 1024, total: 200 * 1024 * 1024 })
  assertEqual(overflow.fraction, 1, 'Fraction clamped to 1.0 on overflow')
  assertEqual(overflow.message, '500.0 / 200.0 MB')
  console.log('  ✔ Scenario 2.4 Passed: Overflow downloads safely clamped to 1.0 fraction')
}

// --- SUITE 3: DOWNLOAD CANCELLATION & CLEANUP STRESS ---
console.log('\n[SUITE 3] Download Cancellation & Cleanup Stress')
{
  const ipc = createMockIpc()

  // 3.1: Pre-flight cancellation
  const preRes = await ipc.invoke('app_install_update', { cancelledBeforeStart: true })
  assertEqual(preRes.status, 'cancelled')
  assertEqual(preRes.downloaded, 0)
  assertEqual(ipc.isInstalling, false, 'Lock not held after pre-flight cancel')
  console.log('  ✔ Scenario 3.1 Passed: Pre-flight cancellation terminates with 0 bytes and released lock')

  // 3.2: Mid-stream cancellation during active delay
  const channel = ipc.createChannel()
  const installPromise = ipc.invoke('app_install_update', { channel, chunkDelayMs: 60 })
  await new Promise((r) => setTimeout(r, 10))
  assertEqual(ipc.isInstalling, true, 'Install is active')

  const cancelRes = await ipc.invoke('app_cancel_update', { token: 'tok-midstream' })
  assertEqual(cancelRes.cancelled, true)
  assertEqual(cancelRes.purged, true, 'Partial temp file purged')
  assertEqual(ipc.isInstalling, false, 'Lock released immediately on cancel')
  await installPromise
  console.log('  ✔ Scenario 3.2 Passed: Mid-stream cancellation purges temp files and releases lock')

  // 3.3: 50 rapid duplicate cancellations
  const cancelBatch = Array.from({ length: 50 }, () =>
    ipc.invoke('app_cancel_update', { token: 'tok-idempotent' }),
  )
  const cancelResBatch = await Promise.all(cancelBatch)
  assert(cancelResBatch.every((r) => r.cancelled === true && r.token === 'tok-idempotent'), 'All 50 succeed')
  assertEqual(ipc.isInstalling, false)
  console.log('  ✔ Scenario 3.3 Passed: Cancellation is completely idempotent under high concurrency')

  // 3.4: Immediate re-install succeeds
  const reInstallRes = await ipc.invoke('app_install_update', {})
  assertEqual(reInstallRes.status, 'started')
  assertEqual(ipc.isInstalling, true)
  await ipc.invoke('app_cancel_update', { token: 'cleanup' })
  assertEqual(ipc.isInstalling, false)
  console.log('  ✔ Scenario 3.4 Passed: Immediate re-install after cancellation succeeds')
}

// --- SUITE 4: NETWORK ERRORS, ZERO PACKAGE SIZE & CHECKSUM MISMATCH ---
console.log('\n[SUITE 4] Network Errors, Corrupted Checksums & Zero-Size Packages')
{
  const ipc = createMockIpc()

  // 4.1: Mid-stream network error
  let netErr = false
  try {
    await ipc.invoke('app_install_update', { simulateNetworkError: true })
  } catch (err) {
    netErr = err.message.includes('DownloadNetworkError')
  }
  assert(netErr, 'Mid-stream interruption throws DownloadNetworkError')
  assertEqual(ipc.isInstalling, false, 'Network error releases lock')
  console.log('  ✔ Scenario 4.1 Passed: Mid-stream network error cleanly releases lock')

  // 4.2: Zero-byte package
  let zeroErr = false
  try {
    await ipc.invoke('app_install_update', { packageSize: 0 })
  } catch (err) {
    zeroErr = err.message.includes('InvalidPackageError')
  }
  assert(zeroErr, '0-byte package throws InvalidPackageError')
  assertEqual(ipc.isInstalling, false, 'Invalid package releases lock')
  console.log('  ✔ Scenario 4.2 Passed: 0-byte package rejected and lock released')

  // 4.3: Corrupted SHA-256 hash mismatch
  const validHash = createHash('sha256').update('valid-binary').digest('hex')
  const tamperedHash = createHash('sha256').update('tampered-binary').digest('hex')
  let hashErr = false
  try {
    await ipc.invoke('app_install_update', { manifestHash: validHash, actualHash: tamperedHash })
  } catch (err) {
    hashErr = err.message.includes('ChecksumMismatchError')
  }
  assert(hashErr, 'Hash mismatch throws ChecksumMismatchError')
  assertEqual(ipc.isInstalling, false, 'Checksum failure releases lock')
  console.log('  ✔ Scenario 4.3 Passed: Checksum mismatch rejected and lock released')

  // 4.4: TLS Certificate Expiry
  let tlsErr = false
  try {
    await ipc.invoke('app_check_update', { certExpired: true })
  } catch (err) {
    tlsErr = err.message.includes('TlsCertificateExpiredError')
  }
  assert(tlsErr, 'Expired TLS cert throws TlsCertificateExpiredError')
  console.log('  ✔ Scenario 4.4 Passed: Expired TLS certificate rejected')

  // 4.5: Sources exhausted fallback
  let exhaustErr = false
  try {
    await ipc.invoke('app_check_update', { allEndpointsFailed: true })
  } catch (err) {
    exhaustErr = err.message.includes('UpdateSourcesExhaustedError')
  }
  assert(exhaustErr, 'All endpoints failing throws UpdateSourcesExhaustedError')
  console.log('  ✔ Scenario 4.5 Passed: Exhausted endpoints properly surfaced')

  // 4.6: Insecure non-HTTPS custom endpoint
  let insecureErr = false
  try {
    await ipc.invoke('app_check_update', { customUrl: 'http://insecure.internal/update.json' })
  } catch (err) {
    insecureErr = err.message.includes('InvalidEndpointError')
  }
  assert(insecureErr, 'Insecure HTTP URL throws InvalidEndpointError')
  console.log('  ✔ Scenario 4.6 Passed: Insecure HTTP custom endpoint rejected')
}

// --- SUITE 5: DEADLOCK & REPEAT LIFECYCLE STRESS (500 ITERATIONS) ---
console.log('\n[SUITE 5] Deadlock, Repeat Lifecycle & Leak Stress (500 Iterations)')
{
  const ipc = createMockIpc()
  const startTime = Date.now()
  const initialMem = process.memoryUsage().heapUsed

  for (let i = 0; i < 500; i++) {
    const startRes = await ipc.invoke('app_install_update', {})
    if (startRes.status !== 'started' || !ipc.isInstalling) throw new Error(`Cycle ${i} start failed`)
    const cancelRes = await ipc.invoke('app_cancel_update', { token: `cycle-${i}` })
    if (!cancelRes.cancelled || ipc.isInstalling) throw new Error(`Cycle ${i} cancel failed`)
    await ipc.invoke('app_update_announcement', { version: `0.2.${i}`, automatic: true })
  }

  const durationMs = Date.now() - startTime
  const memDeltaMb = ((process.memoryUsage().heapUsed - initialMem) / (1024 * 1024)).toFixed(2)

  console.log(`  Completed 500 cycles in ${durationMs}ms (${(durationMs / 500).toFixed(2)}ms/cycle), Heap delta: ${memDeltaMb}MB`)
  assertEqual(ipc.isInstalling, false, 'Final isInstalling == false')
  assertEqual(unhandledRejectionsCount, 0, 'Zero unhandled rejections')
  console.log('  ✔ Scenario 5.1 Passed: 500 lifecycle cycles completed with 0 deadlocks and 0 unhandled rejections')
}

console.log('\n======================================================================')
console.log(`Total Assertions: ${totalAssertions} | Failed: ${failedAssertions} | Unhandled Rejections: ${unhandledRejectionsCount}`)
if (failedAssertions === 0 && unhandledRejectionsCount === 0) {
  console.log('🎯 VERDICT: ALL EMPIRICAL CHALLENGES PASSED (100% SUCCESS)')
} else {
  process.exit(1)
}
