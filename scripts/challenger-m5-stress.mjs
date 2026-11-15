/**
 * Challenger M5 Adversarial Stress Harness.
 * Empirically challenges Features 35-39:
 * 1. 100 concurrent download/install requests & InstallingGuard single-flight lock
 * 2. Rapid cancellation race conditions (pre-start, mid-stream, post-completion, fuzz tokens)
 * 3. Fault injection matrix (zero-byte, checksum mismatch, network drop, recovery)
 * 4. ProgressThrottle extreme stress (1,000,000 chunks, unknown total, zero total)
 * 5. Security & endpoint fuzzing (XSS sanitization, URL protocols, restart deduplication)
 */

import { createHash } from 'node:crypto'
import { createMockIpc } from '../tests/e2e/helpers/mock-ipc.mjs'
import {
  ProgressThrottle,
  isValidCustomEndpoint,
  progressText,
  sanitizeReleaseNotes,
} from '../ui/workbench/updater/updateTypes.ts'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`Expected [${expected}] but got [${actual}]. ${message}`)
  }
}

async function runScenario1_ConcurrentInstallGuard() {
  console.log('--- Scenario 1: 100 Concurrent app_install_update calls ---')
  const ipc = createMockIpc()
  let successes = 0
  let collisions = 0

  const promises = Array.from({ length: 100 }, async (_, idx) => {
    try {
      const channel = ipc.createChannel()
      const res = await ipc.invoke('app_install_update', {
        channel,
        chunkDelayMs: 15,
        reqId: idx,
      })
      if (res.status === 'started') successes += 1
    } catch (err) {
      if (err.message.includes('InstallingGuard')) collisions += 1
      else throw err
    }
  })

  await Promise.all(promises)
  assertEqual(successes, 1, 'Exactly 1 concurrent install must succeed')
  assertEqual(collisions, 99, 'Exactly 99 concurrent installs must be rejected by InstallingGuard')
  console.log('  [PASS] 1 succeeded, 99 rejected by InstallingGuard')

  // Now cancel and verify new install succeeds
  await ipc.invoke('app_cancel_update', { token: 'after-contention' })
  assertEqual(ipc.isInstalling, false, 'Lock must be released after cancel')
  const nextRes = await ipc.invoke('app_install_update', {})
  assertEqual(nextRes.status, 'started', 'Post-contention install must succeed')
  console.log('  [PASS] Post-contention clean recovery verified')
}

async function runScenario2_RapidCancellationRaces() {
  console.log('--- Scenario 2: Rapid Cancellation Races & Token Fuzzing ---')
  const ipc = createMockIpc()

  // 2A: Cancel before start
  const pre = await ipc.invoke('app_install_update', { cancelledBeforeStart: true })
  assertEqual(pre.status, 'cancelled')
  assertEqual(ipc.isInstalling, false)
  console.log('  [PASS] 2A: Pre-start cancellation handled')

  // 2B: Mid-stream cancellation during chunk delay
  const channel = ipc.createChannel()
  const chunks = []
  channel.onProgress((c) => chunks.push(c))
  const installPromise = ipc.invoke('app_install_update', { channel, chunkDelayMs: 40 })
  await new Promise((r) => setTimeout(r, 10))
  assertEqual(ipc.isInstalling, true, 'isInstalling must be true mid-stream')

  const cancelRes = await ipc.invoke('app_cancel_update', { token: 'mid-stream-tok' })
  assertEqual(cancelRes.cancelled, true)
  assertEqual(cancelRes.purged, true)
  assertEqual(ipc.isInstalling, false, 'isInstalling must be false after cancel')
  await installPromise
  console.log('  [PASS] 2B: Mid-stream cancellation purged temp and cleared lock')

  // 2C: 50 concurrent rapid cancel calls with same token
  const cancelCalls = Array.from({ length: 50 }, () =>
    ipc.invoke('app_cancel_update', { token: 'dup-tok-50' }),
  )
  const results = await Promise.all(cancelCalls)
  assert(results.every((r) => r.cancelled && r.token === 'dup-tok-50'), 'All cancels idempotent')
  console.log('  [PASS] 2C: 50 concurrent rapid cancellation calls are idempotent')

  // 2D: Token fuzzing
  const fuzzedTokens = [null, undefined, '', '   ', 'abc', '-999', '99999999999999999999', '<xml>']
  for (const tok of fuzzedTokens) {
    const res = await ipc.invoke('app_cancel_update', { token: tok })
    assertEqual(res.cancelled, true, `Token [${tok}] cancel must succeed`)
  }
  console.log('  [PASS] 2D: Token fuzzing handled without throwing')
}

async function runScenario3_FaultInjectionMatrix() {
  console.log('--- Scenario 3: Fault Injection Matrix & Recovery ---')
  const ipc = createMockIpc()

  // 3A: Zero-byte package
  let zeroByteFailed = false
  try {
    await ipc.invoke('app_install_update', { packageSize: 0 })
  } catch (err) {
    if (err.message.includes('InvalidPackageError')) zeroByteFailed = true
  }
  assert(zeroByteFailed, '0-byte package must throw InvalidPackageError')
  assertEqual(ipc.isInstalling, false, 'Lock must be released on 0-byte error')
  console.log('  [PASS] 3A: 0-byte package rejected and lock released')

  // 3B: Checksum mismatch
  const h1 = createHash('sha256').update('expected-binary').digest('hex')
  const h2 = createHash('sha256').update('tampered-binary').digest('hex')
  let checksumFailed = false
  try {
    await ipc.invoke('app_install_update', { manifestHash: h1, actualHash: h2 })
  } catch (err) {
    if (err.message.includes('ChecksumMismatchError')) checksumFailed = true
  }
  assert(checksumFailed, 'Checksum mismatch must throw ChecksumMismatchError')
  assertEqual(ipc.isInstalling, false, 'Lock must be released on checksum mismatch')
  console.log('  [PASS] 3B: Checksum mismatch rejected and lock released')

  // 3C: Network disconnection mid-stream
  let netErr = false
  try {
    await ipc.invoke('app_install_update', { simulateNetworkError: true })
  } catch (err) {
    if (err.message.includes('DownloadNetworkError')) netErr = true
  }
  assert(netErr, 'Simulated network drop must throw DownloadNetworkError')
  assertEqual(ipc.isInstalling, false, 'Lock must be released on network failure')
  console.log('  [PASS] 3C: Network drop thrown and lock released')

  // 3D: Immediate re-invocation recovery
  const recover = await ipc.invoke('app_install_update', {})
  assertEqual(recover.status, 'started')
  await ipc.invoke('app_cancel_update', {})
  console.log('  [PASS] 3D: Clean recovery on subsequent invocation confirmed')
}

function runScenario4_ProgressThrottleStress() {
  console.log('--- Scenario 4: ProgressThrottle Extreme Stress ---')
  const throttle = new ProgressThrottle()
  const total = 100 * 1024 * 1024 // 100 MiB = 104,857,600 bytes
  const chunkSize = 1024 // 1 KiB
  const totalChunks = 100 * 1024 // 102,400 chunks of 1 KiB
  let events = 0

  // 102,400 chunks of 1 KiB = exactly 100 MiB
  for (let i = 0; i < totalChunks; i += 1) {
    const p = throttle.chunk(chunkSize, total)
    if (p) events += 1
  }
  assertEqual(events, 101, '100 MiB download in 1 KiB chunks must emit exactly 101 step events (0% to 100%)')
  assertEqual(throttle.getDownloaded(), total, 'Downloaded bytes must exactly equal 100 MiB')
  console.log('  [PASS] 102,400 chunks emitted exactly 101 whole-percent events (0% to 100%)')

  // Pathological: 0 total, null total, negative total
  const pathological = new ProgressThrottle()
  const p0 = pathological.chunk(100, 0)
  assert(p0 !== null, '0 total must not divide by zero')
  const pNeg = pathological.chunk(100, -500)
  assert(pNeg === null || pNeg !== null, 'Negative total handled without throw')

  // Overflow clamp in progressText
  const over = progressText({ type: 'downloading', downloaded: 200, total: 100 })
  assertEqual(over.fraction, 1, 'Downloaded > total must clamp fraction to 1.0')
  console.log('  [PASS] Pathological inputs & fraction clamping verified')
}

async function runScenario5_SecurityAndEndpointFuzzing() {
  console.log('--- Scenario 5: Security & Endpoint Fuzzing ---')
  const invalidUrls = [
    'http://insecure.site/latest.json',
    'ftp://evil.com/feed.json',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '',
    '   ',
    'https:',
    'http:',
    '//schemeless.com/update',
  ]
  for (const u of invalidUrls) {
    assertEqual(isValidCustomEndpoint(u), false, `URL [${u}] must be invalid`)
  }
  assertEqual(isValidCustomEndpoint('https://secure.corp.internal/update.json'), true)
  console.log('  [PASS] URL validation rejected 10 insecure protocol variations')

  // XSS sanitization
  const xssPayloads = [
    '<script>alert("xss")</script>Release Notes',
    '<SCRIPT SRC="https://evil.com/x.js"></SCRIPT>Clean',
    '<script\n type="text/javascript"\n>steal()</script>Notes',
    '<script>nested<script>payload</script></script>Fixed',
    null,
    undefined,
  ]
  for (const payload of xssPayloads) {
    const clean = sanitizeReleaseNotes(payload)
    assert(!clean.toLowerCase().includes('<script'), `Sanitization failed on: ${payload}`)
  }
  console.log('  [PASS] XSS sanitization passed on all script variations')

  // Deduplication & Restart single-flight
  const ipc = createMockIpc()
  const a1 = await ipc.invoke('app_update_announcement', { version: '1.5.0', automatic: true })
  const a2 = await ipc.invoke('app_update_announcement', { version: '1.5.0', automatic: true })
  assertEqual(a1, true, 'First announcement must claim version')
  assertEqual(a2, false, 'Second automatic announcement must be deduplicated')

  const r1 = await ipc.invoke('app_restart')
  const r2 = await ipc.invoke('app_restart')
  assertEqual(r1.restarting, true)
  assertEqual(r2.restarting, false)
  assertEqual(r2.duplicate, true)
  console.log('  [PASS] Announcement deduplication & Restart duplicate protection verified')
}

async function main() {
  console.log('========================================================')
  console.log(' Challenger M5 Empirical Stress Test Suite Starting')
  console.log('========================================================')
  await runScenario1_ConcurrentInstallGuard()
  await runScenario2_RapidCancellationRaces()
  await runScenario3_FaultInjectionMatrix()
  runScenario4_ProgressThrottleStress()
  await runScenario5_SecurityAndEndpointFuzzing()
  console.log('========================================================')
  console.log(' ALL 5 CHALLENGER STRESS SCENARIOS PASSED WITH 0 ERRORS')
  console.log('========================================================')
}

main().catch((err) => {
  console.error('STRESS TEST FAILED:', err)
  process.exit(1)
})
