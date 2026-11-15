/**
 * Independent Empirical Challenger Verification Script (challenger_m5_6).
 * Milestone 5: Auto-Update Overhaul (Iteration 3 Validation).
 *
 * Validates:
 * 1. Multi-source fallback resolution and error contracts.
 * 2. Enterprise custom endpoint scheme validation (HTTPS vs non-HTTPS).
 * 3. Release notes sanitization against XSS payloads.
 * 4. Announcement deduplication across versions and check modes.
 * 5. Duplicate restart prevention & active session guards.
 * 6. Concurrency lock (InstallingGuard) and rapid cancellation.
 */

import { createMockIpc } from './e2e/helpers/mock-ipc.mjs'
import {
  CHECK_TASK_ID,
  INSTALL_TASK_ID,
  ProgressThrottle,
  UPDATE_KEY,
  isValidCustomEndpoint,
  megabytes,
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

async function testMultiSourceResolution() {
  console.log('[Test 1] Multi-Source Fallback & Error Contracts')
  const ipc = createMockIpc()

  // 1A. Primary endpoint success
  const primaryRes = await ipc.invoke('app_check_update', { endpoint: 'github' })
  assertEqual(primaryRes.source, 'github')
  assertEqual(primaryRes.available, true)

  // 1B. Primary failure falls back to CNB endpoint
  let primaryFailed = false
  try {
    await ipc.invoke('app_check_update', { simulateFailure: true, source: 'github' })
  } catch (err) {
    if (err.message.includes('Http500ServerError')) primaryFailed = true
  }
  assert(primaryFailed, 'Primary failure must throw Http500ServerError')

  const fallbackRes = await ipc.invoke('app_check_update', { fallbackOnError: true })
  assertEqual(fallbackRes.source, 'cnb_endpoint')
  assertEqual(fallbackRes.available, true)

  // 1C. All endpoints failing triggers UpdateSourcesExhaustedError
  let exhausted = false
  try {
    await ipc.invoke('app_check_update', { allEndpointsFailed: true })
  } catch (err) {
    if (err.message.includes('UpdateSourcesExhaustedError')) exhausted = true
  }
  assert(exhausted, 'All endpoints failing must trigger UpdateSourcesExhaustedError')

  // 1D. TLS certificate expired error
  let certErr = false
  try {
    await ipc.invoke('app_check_update', { certExpired: true })
  } catch (err) {
    if (err.message.includes('TlsCertificateExpiredError')) certErr = true
  }
  assert(certErr, 'Expired TLS certificate must trigger TlsCertificateExpiredError')

  console.log('  -> PASS: Multi-source resolution and error contracts verified.')
}

async function testEnterpriseEndpointValidation() {
  console.log('[Test 2] Custom Enterprise Endpoint Scheme Validation')
  const ipc = createMockIpc()

  const nonHttpsSchemes = [
    'http://internal.corp/updates.json',
    'ftp://repo.corp/omniterm/v1.json',
    'file:///C:/local/updates.json',
    'file:///etc/updates.json',
    'javascript:alert(1)',
    'data:text/json;base64,eyJ2ZXJzaW9uIjoiMS4wLjAifQ==',
    'ws://sockets.corp/updates',
    'wss://sockets.corp/updates',
    'https:',
    'http:',
    '//relative.corp/updates',
    'https:no-slashes',
  ]

  for (const badUrl of nonHttpsSchemes) {
    assertEqual(isValidCustomEndpoint(badUrl), false, `Validator should reject: ${badUrl}`)
    let rejected = false
    try {
      await ipc.invoke('app_check_update', { customUrl: badUrl })
    } catch (err) {
      if (err.message.includes('InvalidEndpointError')) rejected = true
    }
    assert(rejected, `Mock IPC must reject non-HTTPS endpoint: ${badUrl}`)
  }

  // Empty string / whitespace is rejected by validator and falls back to default in IPC
  assertEqual(isValidCustomEndpoint(''), false)
  assertEqual(isValidCustomEndpoint('   '), false)
  const emptyRes = await ipc.invoke('app_check_update', { customUrl: '' })
  assertEqual(emptyRes.source, 'github', 'Empty customUrl should fall back to default source')

  const validHttpsUrls = [
    'https://enterprise.internal.net/omniterm/updates.json',
    'https://127.0.0.1:8443/feed.json',
    'https://[::1]:8443/feed.json',
    'https://updates.omniterm.app/latest.json',
  ]

  for (const goodUrl of validHttpsUrls) {
    assertEqual(isValidCustomEndpoint(goodUrl), true, `Should accept: ${goodUrl}`)
    const res = await ipc.invoke('app_check_update', { customUrl: goodUrl })
    assertEqual(res.source, goodUrl)
    assertEqual(res.available, true)
  }

  console.log('  -> PASS: Non-HTTPS scheme rejection & HTTPS acceptance verified.')
}

async function testReleaseNotesSanitization() {
  console.log('[Test 3] Release Notes Sanitization against XSS')
  const ipc = createMockIpc()

  const attackVectors = [
    { raw: '<script>alert(1)</script>', expectedClean: '' },
    { raw: 'Feature A <script>stealCookies()</script> Feature B', expectedClean: 'Feature A  Feature B' },
    { raw: '<SCRIPT SRC="https://attacker.com/evil.js"></SCRIPT>', expectedClean: '' },
    { raw: '<script type="text/javascript">console.log("xss")</script>Release Notes', expectedClean: 'Release Notes' },
    { raw: '<script>nested<script>inner</script></script>', expectedClean: '</script>' },
    { raw: 'Line 1\n<script>\nmultiLine();\n</script>\nLine 2', expectedClean: 'Line 1\n\nLine 2' },
    { raw: null, expectedClean: '' },
    { raw: undefined, expectedClean: '' },
    { raw: '', expectedClean: '' },
  ]

  for (const { raw, expectedClean } of attackVectors) {
    const sanitized = sanitizeReleaseNotes(raw)
    assertEqual(sanitized, expectedClean, `Sanitization mismatch for input: ${raw}`)
    assert(!sanitized.toLowerCase().includes('<script'), `Sanitized output contains <script: ${sanitized}`)
  }

  // Also verify Mock IPC app_check_update sanitizes notes
  const ipcRes = await ipc.invoke('app_check_update', {
    releaseNotes: 'Update notes: <script>document.location="http://evil.com"</script> Bug fixes.',
  })
  assert(!ipcRes.releaseNotes.includes('<script>'), 'IPC releaseNotes must not contain <script>')
  assert(ipcRes.releaseNotes.includes('Bug fixes.'), 'IPC releaseNotes preserves legitimate content')

  console.log('  -> PASS: Release notes XSS stripping verified across all vectors.')
}

async function testAnnouncementDeduplication() {
  console.log('[Test 4] Announcement Deduplication')
  const ipc = createMockIpc()

  // First check on v0.2.0 (automatic) -> true (claimed)
  const a1 = await ipc.invoke('app_update_announcement', { version: '0.2.0', automatic: true })
  assertEqual(a1, true, 'First automatic announcement must be accepted')

  // Duplicate check on v0.2.0 (automatic) -> false (deduplicated)
  const a2 = await ipc.invoke('app_update_announcement', { version: '0.2.0', automatic: true })
  assertEqual(a2, false, 'Duplicate automatic announcement must be deduplicated')

  // Manual check on v0.2.0 (automatic: false) -> true (manual check always displays)
  const aManual = await ipc.invoke('app_update_announcement', { version: '0.2.0', automatic: false })
  assertEqual(aManual, true, 'Manual check on existing version must return true')

  // New version v0.3.0 (automatic) -> true (new version claimed)
  const a3 = await ipc.invoke('app_update_announcement', { version: '0.3.0', automatic: true })
  assertEqual(a3, true, 'New version announcement must be accepted')

  // Subsequent check on v0.3.0 -> false
  const a4 = await ipc.invoke('app_update_announcement', { version: '0.3.0', automatic: true })
  assertEqual(a4, false, 'Duplicate announcement on v0.3.0 must be deduplicated')

  console.log('  -> PASS: Version announcement deduplication verified.')
}

async function testDuplicateRestartPrevention() {
  console.log('[Test 5] Duplicate Restart Prevention')
  const ipc = createMockIpc()

  // First restart invocation -> restarting: true
  const r1 = await ipc.invoke('app_restart')
  assertEqual(r1.restarting, true)

  // Second restart invocation -> restarting: false, duplicate: true
  const r2 = await ipc.invoke('app_restart')
  assertEqual(r2.restarting, false)
  assertEqual(r2.duplicate, true)

  // Third restart invocation -> duplicate: true
  const r3 = await ipc.invoke('app_restart')
  assertEqual(r3.restarting, false)
  assertEqual(r3.duplicate, true)

  console.log('  -> PASS: Duplicate restart prevention verified.')
}

async function testInstallingGuardAndCancellationStress() {
  console.log('[Test 6] InstallingGuard Concurrency & Rapid Cancellation')
  const ipc = createMockIpc()

  // 6A. Concurrency lock: 20 simultaneous install calls
  let started = 0
  let locked = 0
  const promises = Array.from({ length: 20 }, async () => {
    try {
      const channel = ipc.createChannel()
      const res = await ipc.invoke('app_install_update', { channel, chunkDelayMs: 20 })
      if (res.status === 'started') started += 1
    } catch (err) {
      if (err.message.includes('InstallingGuard')) locked += 1
      else throw err
    }
  })
  await Promise.all(promises)
  assertEqual(started, 1, 'Exactly 1 install call must acquire InstallingGuard')
  assertEqual(locked, 19, '19 calls must be rejected by InstallingGuard')

  // 6B. Cancellation releases lock
  const cancelRes = await ipc.invoke('app_cancel_update', { token: 'tok-release-test' })
  assertEqual(cancelRes.cancelled, true)
  assertEqual(ipc.isInstalling, false)

  // 6C. Immediate re-acquisition succeeds
  const reacquire = await ipc.invoke('app_install_update', {})
  assertEqual(reacquire.status, 'started')
  assertEqual(ipc.isInstalling, true)
  await ipc.invoke('app_cancel_update', {})

  console.log('  -> PASS: InstallingGuard concurrency and clean lock recovery verified.')
}

function testProgressThrottleAndFormatting() {
  console.log('[Test 7] ProgressThrottle Extreme Stress & Formatting')

  // 100 MiB download in 512-byte chunks = 204,800 chunks
  const throttle = new ProgressThrottle()
  const total = 100 * 1024 * 1024
  const chunkSize = 512
  const chunkCount = total / chunkSize
  let emitted = 0

  for (let i = 0; i < chunkCount; i += 1) {
    const p = throttle.chunk(chunkSize, total)
    if (p) emitted += 1
  }
  // Step is from 0% to 100% -> exactly 101 steps
  assertEqual(emitted, 101, 'ProgressThrottle must emit exactly 101 whole-percent steps')
  assertEqual(throttle.getDownloaded(), total, 'Downloaded bytes must match total')

  // Unknown total: throttles by 256KiB step
  const unkThrottle = new ProgressThrottle()
  let unkEmitted = 0
  for (let i = 0; i < 1000; i += 1) {
    const p = unkThrottle.chunk(16 * 1024, null)
    if (p) unkEmitted += 1
  }
  assert(unkEmitted < 70, 'Unknown total throttled by 256KiB step')

  // Boundary progressText tests
  const over = progressText({ type: 'downloading', downloaded: 200, total: 100 })
  assertEqual(over.fraction, 1)

  const indet = progressText({ type: 'downloading', downloaded: 1048576, total: -1 })
  assertEqual(indet.fraction, null)
  assertEqual(indet.message, '1.0 MB')

  const zeroTot = progressText({ type: 'downloading', downloaded: 0, total: 0 })
  assertEqual(zeroTot.fraction, null)

  console.log('  -> PASS: ProgressThrottle 204,800 chunk stress & text formatting verified.')
}

async function runAll() {
  console.log('=================================================================')
  console.log(' EMPIRICAL CHALLENGER VERIFICATION HARNESS (challenger_m5_6)')
  console.log('=================================================================')
  await testMultiSourceResolution()
  await testEnterpriseEndpointValidation()
  await testReleaseNotesSanitization()
  await testAnnouncementDeduplication()
  await testDuplicateRestartPrevention()
  await testInstallingGuardAndCancellationStress()
  testProgressThrottleAndFormatting()
  console.log('=================================================================')
  console.log(' ALL 7 EMPIRICAL CHALLENGER TEST SUITES PASSED (0 ERRORS)')
  console.log('=================================================================')
}

runAll().catch((err) => {
  console.error('CHALLENGER HARNESS FAILED:', err)
  process.exit(1)
})
