import assert from 'node:assert/strict'
import test from 'node:test'

import { DEV_PORT, freeDevPort, killPids, listListeners } from '../free-dev-port.mjs'

/**
 * Fake runner: a small lookup table keyed by command, returning canned `{ status, stdout, error }`.
 * Lets the same fake serve both the enumerate step (netstat/lsof) and the kill step (taskkill/kill).
 */
function fakeRunner(table) {
  return (command, args) => {
    const entry = table[command]
    if (!entry) return { status: 1, stdout: '' }
    if (typeof entry === 'function') return entry(args)
    return { status: entry.status ?? 0, stdout: entry.stdout ?? '', error: entry.error }
  }
}

test('DEV_PORT is the fixed dev port shared with vite/tauri config', () => {
  assert.equal(DEV_PORT, 5173)
})

// ── listListeners: Windows netstat ──────────────────────────────────────────

const NETSTAT_IPV4 = [
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       31156',
  '  TCP    [::]:5173              [::]:0                 LISTENING       31156',
  '  TCP    192.168.1.5:54321      10.0.0.1:443           ESTABLISHED     999',
].join('\r\n')

test('listListeners parses Windows netstat for IPv4+IPv6 and dedupes the same PID', () => {
  const runner = fakeRunner({ netstat: { stdout: NETSTAT_IPV4 } })
  assert.deepEqual(listListeners(5173, { platform: 'win32', runner }), [31156])
})

test('listListeners ignores a foreign ESTABLISHED row whose remote port happens to match', () => {
  const netstat = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       4242',
    '  TCP    10.0.0.1:49152         93.184.216.34:5173     ESTABLISHED     777',
  ].join('\r\n')
  const runner = fakeRunner({ netstat: { stdout: netstat } })
  assert.deepEqual(listListeners(5173, { platform: 'win32', runner }), [4242])
})

test('listListeners returns [] when nothing is LISTENING on Windows', () => {
  const runner = fakeRunner({ netstat: { stdout: '' } })
  assert.deepEqual(listListeners(5173, { platform: 'win32', runner }), [])
})

test('listListeners tolerates a netstat failure on Windows', () => {
  const runner = fakeRunner({ netstat: { status: 1, stdout: '' } })
  assert.deepEqual(listListeners(5173, { platform: 'win32', runner }), [])
})

// ── listListeners: POSIX lsof ───────────────────────────────────────────────

test('listListeners parses lsof terse PID output and dedupes', () => {
  const runner = fakeRunner({ lsof: { stdout: '31156\n31156\n99\n' } })
  assert.deepEqual(listListeners(5173, { platform: 'darwin', runner }), [31156, 99])
})

test('listListeners returns [] when lsof finds nothing (exit 1, no stdout)', () => {
  const runner = fakeRunner({ lsof: { status: 1, stdout: '' } })
  assert.deepEqual(listListeners(5173, { platform: 'darwin', runner }), [])
})

test('listListeners returns [] when lsof is not installed (spawn error)', () => {
  const runner = fakeRunner({ lsof: { error: new Error('enoent'), status: null, stdout: '' } })
  assert.deepEqual(listListeners(5173, { platform: 'linux', runner }), [])
})

// ── killPids ─────────────────────────────────────────────────────────────────

test('killPids on Windows calls taskkill per PID and splits killed/failed on status', () => {
  const calls = []
  const runner = (command, args) => {
    calls.push([command, ...args].join(' '))
    // Fail the second pid to exercise the failed bucket.
    return args[args.length - 1] === '99' ? { status: 1 } : { status: 0 }
  }
  const { killed, failed } = killPids([31156, 99], { platform: 'win32', runner })
  assert.deepEqual(killed, [31156])
  assert.deepEqual(failed, [99])
  assert.deepEqual(calls, ['taskkill /F /T /PID 31156', 'taskkill /F /T /PID 99'])
})

test('killPids on POSIX calls `kill -9` and splits on status', () => {
  const calls = []
  const runner = (command, args) => {
    calls.push([command, ...args].join(' '))
    return { status: 0 }
  }
  const { killed, failed } = killPids([1, 2], { platform: 'darwin', runner })
  assert.deepEqual(killed, [1, 2])
  assert.deepEqual(failed, [])
  assert.deepEqual(calls, ['kill -9 1', 'kill -9 2'])
})

// ── freeDevPort orchestration ─────────────────────────────────────────────

test('freeDevPort frees the orphan and logs the PID it stopped (Windows)', () => {
  const logs = []
  const runner = fakeRunner({
    netstat: { stdout: '  TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    31156\r\n' },
    taskkill: { status: 0 },
  })
  const result = freeDevPort({ platform: 'win32', runner, log: (...a) => logs.push(a.join(' ')) })
  assert.deepEqual(result, { killed: [31156], failed: [] })
  assert.match(logs.join('\n'), /freed 31156/)
})

test('freeDevPort reports a free port without attempting any kills', () => {
  const killCalls = []
  const runner = (command) => {
    if (command === 'taskkill') killCalls.push(command)
    return command === 'netstat' ? { status: 0, stdout: '' } : { status: 0 }
  }
  const logs = []
  const result = freeDevPort({ platform: 'win32', runner, log: (...a) => logs.push(a.join(' ')) })
  assert.deepEqual(result, { killed: [], failed: [] })
  assert.equal(killCalls.length, 0)
  assert.match(logs.join('\n'), /5173 free/)
})

test('freeDevPort logs the survivors when a kill fails', () => {
  const logs = []
  const runner = fakeRunner({
    lsof: { stdout: '7\n8\n' },
    kill: (args) => (args[args.length - 1] === '8' ? { status: 1 } : { status: 0 }),
  })
  const result = freeDevPort({ platform: 'darwin', runner, log: (...a) => logs.push(a.join(' ')) })
  assert.deepEqual(result, { killed: [7], failed: [8] })
  assert.match(logs.join('\n'), /kept 8 — could not stop/)
})
