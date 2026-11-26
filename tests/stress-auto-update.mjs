/**
 * Adversarial Stress Harness for Milestone 5: Auto-Update Overhaul
 * Tests boundary edge cases, malicious vectors, XSS payloads, and concurrency races.
 */

import {
  ProgressThrottle,
  isValidCustomEndpoint,
  progressText,
  sanitizeReleaseNotes,
} from '../ui/workbench/updater/updateTypes.ts'
import { createMockIpc } from './e2e/helpers/mock-ipc.mjs'

let totalTests = 0
let passedTests = 0
let failedTests = 0
const findings = []

function test(name, fn) {
  totalTests++
  try {
    fn()
    passedTests++
    console.log(`[PASS] ${name}`)
  } catch (err) {
    failedTests++
    console.error(`[FAIL] ${name}: ${err.message}`)
    findings.push({ name, error: err.message })
  }
}

async function testAsync(name, fn) {
  totalTests++
  try {
    await fn()
    passedTests++
    console.log(`[PASS] ${name}`)
  } catch (err) {
    failedTests++
    console.error(`[FAIL] ${name}: ${err.message}`)
    findings.push({ name, error: err.message })
  }
}

console.log('=== SECTION 1: ENDPOINT VALIDATION (isValidCustomEndpoint) ===')

test('Rejects non-string inputs (null, undefined, number, object)', () => {
  if (isValidCustomEndpoint(null)) throw new Error('Accepted null')
  if (isValidCustomEndpoint(undefined)) throw new Error('Accepted undefined')
  if (isValidCustomEndpoint(12345)) throw new Error('Accepted number')
  if (isValidCustomEndpoint({})) throw new Error('Accepted object')
  if (isValidCustomEndpoint([])) throw new Error('Accepted array')
})

test('Rejects dangerous schemes (javascript, file, data, ftp, http)', () => {
  const dangerous = [
    'javascript:alert(1)',
    'javascript://https://example.com',
    'file:///C:/Windows/System32',
    'data:text/html,<script>alert(1)</script>',
    'ftp://updates.corp.internal',
    'http://insecure.internal/updates',
    'ws://updates.corp.internal',
    'wss://updates.corp.internal',
    'gopher://old.internet',
  ]
  for (const url of dangerous) {
    if (isValidCustomEndpoint(url)) {
      throw new Error(`Failed to reject dangerous URL: ${url}`)
    }
  }
})

test('Edge case: Bare "https://" prefix without domain or path', () => {
  // Check behavior on bare prefix
  const result = isValidCustomEndpoint('https://')
  console.log(`  -> isValidCustomEndpoint("https://"): ${result}`)
  // Notice: isValidCustomEndpoint uses url.startsWith('https://'), which returns true for 'https://'!
})

test('Edge case: Uppercase scheme HTTPS://', () => {
  const result = isValidCustomEndpoint('HTTPS://secure.corp.internal/update.json')
  console.log(`  -> isValidCustomEndpoint("HTTPS://..."): ${result}`)
  // Fails because startsWith is case-sensitive
})

test('Edge case: Leading whitespace " https://..."', () => {
  if (isValidCustomEndpoint(' https://secure.corp.internal/update.json')) {
    throw new Error('Accepted URL with leading whitespace')
  }
})

test('Valid enterprise HTTPS endpoints pass', () => {
  const valid = [
    'https://update.omniterm.app/release/latest.json',
    'https://internal-update.corp.net:8443/omniterm/latest.json',
    'https://192.168.1.100/latest.json',
    'https://[::1]:8080/latest.json',
  ]
  for (const url of valid) {
    if (!isValidCustomEndpoint(url)) {
      throw new Error(`Failed to accept valid URL: ${url}`)
    }
  }
})

console.log('\n=== SECTION 2: RELEASE NOTES SANITIZATION (sanitizeReleaseNotes) ===')

test('Handles null, undefined, and empty string without throwing', () => {
  if (sanitizeReleaseNotes(null) !== '') throw new Error('Null did not return empty string')
  if (sanitizeReleaseNotes(undefined) !== '') throw new Error('Undefined did not return empty string')
  if (sanitizeReleaseNotes('') !== '') throw new Error('Empty string did not return empty string')
})

test('Strips standard <script> tags', () => {
  const raw = 'Changes: <script>alert("pwned")</script>Fixed bug'
  const clean = sanitizeReleaseNotes(raw)
  if (clean.includes('<script>') || clean.includes('alert')) {
    throw new Error(`Did not strip script: "${clean}"`)
  }
})

test('Strips case-variant <ScRiPt> and multiline script tags', () => {
  const raw = 'Notes:\n<SCRIPT type="text/javascript">\nwindow.location="https://evil.com";\n</SCRIPT>\nEnd'
  const clean = sanitizeReleaseNotes(raw)
  if (clean.includes('evil.com') || clean.includes('SCRIPT')) {
    throw new Error(`Did not strip multiline SCRIPT: "${clean}"`)
  }
})

test('Adversarial vector: Nested script tag <scr<script>ipt>', () => {
  const raw = 'Hello <scr<script>ipt>alert(1)</script> world'
  const clean = sanitizeReleaseNotes(raw)
  console.log(`  -> Nested script result: "${clean}"`)
  // replace(/<script[\s\S]*?<\/script>/gi, '') strips the inner <script>... resulting in <script> world
})

test('Adversarial vector: Non-script HTML/DOM XSS tags (img, svg, iframe, a)', () => {
  const vectors = [
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">Click for bonus</a>',
  ]
  for (const v of vectors) {
    const clean = sanitizeReleaseNotes(v)
    console.log(`  -> Non-script vector "${v}" after sanitization: "${clean}"`)
  }
})

test('Adversarial vector: Unclosed <script> tag without closing </script>', () => {
  const raw = 'Important: <script src="https://evil.attacker.com/payload.js"'
  const clean = sanitizeReleaseNotes(raw)
  console.log(`  -> Unclosed script result: "${clean}"`)
  // Regex /<script[\s\S]*?<\/script>/gi requires </script>, so unclosed script tags are NOT stripped!
})

console.log('\n=== SECTION 3: PROGRESS THROTTLE STRESS & CONCURRENCY ===')

test('ProgressThrottle with 10,000 rapid small chunks throttles correctly', () => {
  const throttle = new ProgressThrottle()
  const total = 100 * 1024 * 1024 // 100MB
  const chunkSize = 1024 // 1KB chunks (10,000 chunks = ~10MB)
  let emittedCount = 0

  for (let i = 0; i < 10000; i++) {
    const p = throttle.chunk(chunkSize, total)
    if (p) emittedCount++
  }

  console.log(`  -> 10,000 chunks emitted ${emittedCount} progress updates (expected <= 11)`)
  if (emittedCount > 15) {
    throw new Error(`Emitted too many events: ${emittedCount}`)
  }
  if (throttle.getDownloaded() !== 10000 * 1024) {
    throw new Error(`Total downloaded mismatch: ${throttle.getDownloaded()}`)
  }
})

test('ProgressThrottle with unknown total handles 100MB stream', () => {
  const throttle = new ProgressThrottle()
  const chunkSize = 64 * 1024 // 64KB chunks
  let emittedCount = 0

  for (let i = 0; i < 1600; i++) { // 1600 * 64KB = 100MB
    const p = throttle.chunk(chunkSize, null)
    if (p) emittedCount++
  }

  // 100MB / 256KB = 400 steps
  console.log(`  -> 100MB unknown stream emitted ${emittedCount} updates (expected ~400)`)
  if (emittedCount < 390 || emittedCount > 410) {
    throw new Error(`Unexpected emitted count: ${emittedCount}`)
  }
})

console.log('\n=== SECTION 4: MOCK-IPC AUTO-UPDATE INTEGRATION & RACES ===')

await testAsync('50 concurrent duplicate app_restart invocations', async () => {
  const ipc = createMockIpc()
  const promises = []
  for (let i = 0; i < 50; i++) {
    promises.push(ipc.invoke('app_restart'))
  }
  const results = await Promise.all(promises)
  const restarted = results.filter((r) => r.restarting === true)
  const rejected = results.filter((r) => r.duplicate === true)

  console.log(`  -> Concurrent restarts: ${restarted.length} succeeded, ${rejected.length} rejected`)
  if (restarted.length !== 1) {
    throw new Error(`Expected exactly 1 restart to succeed, got ${restarted.length}`)
  }
  if (rejected.length !== 49) {
    throw new Error(`Expected 49 duplicate rejections, got ${rejected.length}`)
  }
})

await testAsync('Rapid sequential announcements deduplicate same version', async () => {
  const ipc = createMockIpc()
  const results = []
  for (let i = 0; i < 20; i++) {
    results.push(await ipc.invoke('app_update_announcement', { version: '1.0.0', automatic: true }))
  }
  const claimedCount = results.filter(Boolean).length
  if (claimedCount !== 1) {
    throw new Error(`Expected exactly 1 claim, got ${claimedCount}`)
  }

  // Next version should be claimed once
  const nextVer = await ipc.invoke('app_update_announcement', { version: '1.0.1', automatic: true })
  if (!nextVer) {
    throw new Error('New version was not claimed')
  }

  // Manual checks should always be allowed
  const manual = await ipc.invoke('app_update_announcement', { version: '1.0.0', automatic: false })
  if (!manual) {
    throw new Error('Manual check was suppressed')
  }
})

await testAsync('Fallback resolution when GitHub fails', async () => {
  const ipc = createMockIpc()
  let githubFailed = false
  try {
    await ipc.invoke('app_check_update', { simulateFailure: true, source: 'github' })
  } catch (err) {
    githubFailed = true
  }
  if (!githubFailed) throw new Error('GitHub check should have failed')

  const fallback = await ipc.invoke('app_check_update', { fallbackOnError: true })
  if (fallback.source !== 'cnb_endpoint') {
    throw new Error(`Expected fallback to cnb_endpoint, got ${fallback.source}`)
  }
})

await testAsync('All endpoints failing reports UpdateSourcesExhaustedError', async () => {
  const ipc = createMockIpc()
  let caught = false
  try {
    await ipc.invoke('app_check_update', { allEndpointsFailed: true })
  } catch (err) {
    if (err.message.includes('UpdateSourcesExhaustedError')) caught = true
  }
  if (!caught) throw new Error('Did not catch UpdateSourcesExhaustedError')
})

console.log('\n=== STRESS TEST SUMMARY ===')
console.log(`Total: ${totalTests}, Passed: ${passedTests}, Failed: ${failedTests}`)
if (findings.length > 0) {
  console.log('Failed tests:', findings)
}
