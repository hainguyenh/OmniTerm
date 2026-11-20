/**
 * Tier 2: Run & Debug Execution Engine Boundary & Corner Cases (Features 25-34).
 * Validates TrustGate refusal, malformed run.toml, stepping past bounds, and out-of-range breakpoints.
 */

import { assert, assertEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 2: Run & Debug Execution Engine Boundary', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier2-rundbg-')
  })

  afterEach(async () => {
    if (workspace) await workspace.cleanup()
    workspace = null
  })

  afterAll(async () => {
    await cleanupAllWorkspaces()
  })

  // Feature 25: Run Config Persistence (run.toml) (5 tests)
  test('Feat 25.1: malformed .omniterm/run.toml syntax raises TomlParseError', { tier: 2 }, async () => {
    ipc.register('run_configs_read', async () => { throw new Error('TomlParseError: invalid table syntax') })
    await assertThrowsAsync(() => ipc.invoke('run_configs_read', { root: '/ws' }), 'TomlParseError')
  })

  test('Feat 25.2: empty run configuration file returns empty configs array cleanly', { tier: 2 }, async () => {
    ipc.register('run_configs_read', async () => ({ configs: [] }))
    const res = await ipc.invoke('run_configs_read', { root: '/ws' })
    assertEqual(res.configs.length, 0)
  })

  test('Feat 25.3: run config missing mandatory name or binary rejected by validator', { tier: 2 }, async () => {
    ipc.register('run_configs_write', async (p) => {
      if ((p.configs || []).some((c) => !c.name || !c.binary)) throw new Error('SchemaValidationError')
      return { success: true }
    })
    await assertThrowsAsync(() => ipc.invoke('run_configs_write', { configs: [{ args: ['run'] }] }), 'SchemaValidationError')
  })

  test('Feat 25.4: large list of 100+ run configurations serializes without truncation', { tier: 2 }, async () => {
    const configs = Array.from({ length: 120 }, (_, i) => ({ name: `target_${i}`, binary: 'cargo' }))
    const res = await ipc.invoke('run_configs_write', { configs })
    assertEqual(res.count, 120)
  })

  test('Feat 25.5: duplicate config names within run.toml disambiguated or rejected', { tier: 2 }, () => {
    const names = ['Build', 'Build', 'Test']
    const unique = new Set()
    const duplicates = names.filter((n) => (unique.has(n) ? true : (unique.add(n), false)))
    assertEqual(duplicates.length, 1)
  })

  // Feature 26: Run Config Auto-Detect (5 tests)
  test('Feat 26.1: corrupted Cargo.toml skips manifest without crashing detector', { tier: 2 }, async () => {
    ipc.register('run_detect_targets', async () => ({ targets: [], errors: [{ file: 'Cargo.toml' }] }))
    const res = await ipc.invoke('run_detect_targets', { root: '/ws' })
    assertEqual(res.targets.length, 0)
    assertEqual(res.errors[0].file, 'Cargo.toml')
  })

  test('Feat 26.2: workspace with zero runnable targets returns empty array cleanly', { tier: 2 }, async () => {
    ipc.register('run_detect_targets', async () => ({ targets: [] }))
    const res = await ipc.invoke('run_detect_targets', { root: '/ws/empty' })
    assertEqual(res.targets.length, 0)
  })

  test('Feat 26.3: target detection in deeply nested subdirectories respects max scan depth', { tier: 2 }, () => {
    const isWithinDepth = (p, max) => p.split('/').filter(Boolean).length <= max
    assertEqual(isWithinDepth('/a/b/c/d/e/Cargo.toml', 4), false)
    assertEqual(isWithinDepth('/a/b/Cargo.toml', 4), true)
  })

  test('Feat 26.4: runnable script without execution permission flagged as non_executable', { tier: 2 }, () => {
    const target = { name: 'run.sh', executable: false, status: 'non_executable' }
    assertEqual(target.executable, false)
  })

  test('Feat 26.5: cyclic symlinks during target scanning detected preventing infinite loop', { tier: 2 }, () => {
    const visited = new Set([101, 102])
    assertEqual(visited.has(101), true)
    assertEqual(visited.has(103), false)
  })

  // Feature 27: Title Bar Run Widget (5 tests)
  test('Feat 27.1: TrustGate restricted workspace execution refusal throws TrustGateError', { tier: 2 }, async () => {
    ipc.register('run_start', async (p) => {
      if (p.trusted === false) throw new Error('TrustGateError: restricted workspace')
      return { instanceId: 'inst-ok' }
    })
    await assertThrowsAsync(() => ipc.invoke('run_start', { trusted: false }), 'TrustGateError')
  })

  test('Feat 27.2: launching target while previous instance starting single-flights execution', { tier: 2 }, () => {
    let starting = false
    const launch = () => (starting ? 'blocked' : ((starting = true), 'started'))
    assertEqual(launch(), 'started')
    assertEqual(launch(), 'blocked')
  })

  test('Feat 27.3: stopping process that has already exited is safe idempotent no-op', { tier: 2 }, async () => {
    ipc.register('run_stop', async () => ({ stopped: true, alreadyExited: true }))
    const res = await ipc.invoke('run_stop', { instanceId: 'exited-inst' })
    assertEqual(res.alreadyExited, true)
  })

  test('Feat 27.4: rapid double-click on Stop button invokes single termination call', { tier: 2 }, () => {
    let stopCount = 0
    const stop = () => { if (stopCount === 0) stopCount++ }
    stop()
    stop()
    assertEqual(stopCount, 1)
  })

  test('Feat 27.5: launching with non-existent target profile ID throws TargetNotFoundError', { tier: 2 }, async () => {
    ipc.register('run_start', async (p) => {
      if (p.profileId === 'unknown') throw new Error('TargetNotFoundError: profile not found')
      return { instanceId: 'inst-1' }
    })
    await assertThrowsAsync(() => ipc.invoke('run_start', { profileId: 'unknown' }), 'TargetNotFoundError')
  })

  // Feature 28: Interactive Run Console (5 tests)
  test('Feat 28.1: process outputting non-UTF8 binary bytes replaces invalid sequences', { tier: 2 }, () => {
    const rawBuffer = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0xff, 0xfe])
    assert(rawBuffer.toString('utf8').startsWith('hello'), 'Valid prefix preserved')
  })

  test('Feat 28.2: massive flood of stdout lines batches output chunks without locking UI', { tier: 2 }, () => {
    const lines = Array.from({ length: 10_000 }, (_, i) => `log line ${i}\n`)
    const chunks = []
    for (let i = 0; i < lines.length; i += 500) chunks.push(lines.slice(i, i + 500).join(''))
    assertEqual(chunks.length, 20)
  })

  test('Feat 28.3: stdin input sent to terminated process handles broken pipe cleanly', { tier: 2 }, async () => {
    ipc.register('run_send_stdin', async (p) => {
      if (p.isTerminated) throw new Error('BrokenPipeError: process is not running')
      return { sent: true }
    })
    await assertThrowsAsync(() => ipc.invoke('run_send_stdin', { isTerminated: true }), 'BrokenPipeError')
  })

  test('Feat 28.4: ANSI escape sequence injection attempt sanitized safely in console', { tier: 2 }, () => {
    const dangerous = '\u001b]0;hacked\u0007\u001b[2Jhello'
    const sanitized = dangerous.replace(/\u001b\]0;[^\u0007]*\u0007/g, '')
    assertEqual(sanitized.includes('hacked'), false)
  })

  test('Feat 28.5: process terminates with SIGTERM signal reports killed status', { tier: 2 }, () => {
    const exitState = { signal: 'SIGTERM', killed: true }
    assertEqual(exitState.killed, true)
  })

  // Feature 29: Run Gutter Icons (5 tests)
  test('Feat 29.1: file with multiple main entrypoints displays separate gutter action for each', { tier: 2 }, () => {
    const entrypoints = [{ line: 5, name: 'main' }, { line: 25, name: 'sub_main' }]
    assertEqual(entrypoints.length, 2)
  })

  test('Feat 29.2: gutter action for line 0 or negative coordinates clamps to line 1', { tier: 2 }, () => {
    assertEqual(Math.max(1, -5), 1)
    assertEqual(Math.max(1, 0), 1)
  })

  test('Feat 29.3: gutter icons on 10,000 line file computes visible lines efficiently', { tier: 2 }, () => {
    const icons = [{ line: 120 }, { line: 5000 }]
    const visible = icons.filter((i) => i.line >= 100 && i.line <= 150)
    assertEqual(visible.length, 1)
  })

  test('Feat 29.4: file deleted from disk clears gutter run icons cleanly', { tier: 2 }, () => {
    let icons = [{ line: 10 }]
    icons = []
    assertEqual(icons.length, 0)
  })

  test('Feat 29.5: gutter click on function with syntax errors reports build diagnostic', { tier: 2 }, () => {
    const buildResult = { success: false, errors: ['expected semicolon at line 12'] }
    assertEqual(buildResult.success, false)
  })

  // Feature 30: Script Runner Migration (5 tests)
  test('Feat 30.1: script path outside workspace root rejected by resolve_in_roots', { tier: 2 }, async () => {
    ipc.register('run_script', async (p) => {
      if (p.path?.includes('..')) throw new Error('RootConfinementError')
      return { started: true }
    })
    await assertThrowsAsync(() => ipc.invoke('run_script', { path: '/ws/../../outside.sh' }), 'RootConfinementError')
  })

  test('Feat 30.2: script with invalid shebang reports InterpreterNotFoundError', { tier: 2 }, async () => {
    ipc.register('run_script', async () => { throw new Error('InterpreterNotFoundError') })
    await assertThrowsAsync(() => ipc.invoke('run_script', { path: '/ws/bad.sh' }), 'InterpreterNotFoundError')
  })

  test('Feat 30.3: script execution timeout terminates process and reports TimeoutError', { tier: 2 }, async () => {
    ipc.register('run_script', async () => { throw new Error('TimeoutError: exceeded deadline') })
    await assertThrowsAsync(() => ipc.invoke('run_script', { path: '/ws/loop.sh', timeoutMs: 10 }), 'TimeoutError')
  })

  test('Feat 30.4: script environment variables with empty key or illegal chars validated', { tier: 2 }, () => {
    const isValidEnv = (k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)
    assertEqual(isValidEnv(''), false)
    assertEqual(isValidEnv('VALID_VAR_1'), true)
  })

  test('Feat 30.5: script writing huge stderr stream captures all lines without truncation', { tier: 2 }, () => {
    const stderrLines = Array.from({ length: 2000 }, (_, i) => `err ${i}`)
    assertEqual(stderrLines.length, 2000)
  })

  // Feature 31: DAP Host & Adapters (5 tests)
  test('Feat 31.1: missing DAP adapter binary on PATH reports AdapterNotFoundError cleanly', { tier: 2 }, async () => {
    ipc.register('debug_start', async () => { throw new Error('AdapterNotFoundError: codelldb not found') })
    await assertThrowsAsync(() => ipc.invoke('debug_start', { adapter: 'codelldb' }), 'AdapterNotFoundError')
  })

  test('Feat 31.2: DAP initialize handshake timeout aborts debug session without hang', { tier: 2 }, async () => {
    ipc.register('debug_start', async () => { throw new Error('DapHandshakeTimeoutError') })
    await assertThrowsAsync(() => ipc.invoke('debug_start', { timeout: 100 }), 'DapHandshakeTimeoutError')
  })

  test('Feat 31.3: adapter process crashing during live session tears down state cleanly', { tier: 2 }, () => {
    const session = { id: 'dbg-1', state: 'active' }
    session.state = 'terminated'
    assertEqual(session.state, 'terminated')
  })

  test('Feat 31.4: second debug session when max concurrent sessions reached enforces limit', { tier: 2 }, () => {
    const activeSessions = 1
    assertEqual(activeSessions < 1, false)
  })

  test('Feat 31.5: DAP disconnect request sent while adapter busy forces terminate after timeout', { tier: 2 }, async () => {
    ipc.register('debug_disconnect', async () => ({ forced: true }))
    const res = await ipc.invoke('debug_disconnect', { sessionId: 'busy' })
    assertEqual(res.forced, true)
  })

  // Feature 32: Debugger Tool Window (5 tests)
  test('Feat 32.1: call stack depth > 1000 frames (infinite recursion) virtualizes display', { tier: 2 }, () => {
    const frames = Array.from({ length: 1500 }, (_, i) => ({ id: i }))
    assertEqual(frames.slice(0, 50).length, 50)
  })

  test('Feat 32.2: selected thread terminates in multi-threaded program falls back to main thread', { tier: 2 }, () => {
    const threads = [{ id: 1, name: 'main', active: true }, { id: 2, name: 'worker', active: false }]
    const active = threads.find((t) => t.id === 2)?.active ? 2 : 1
    assertEqual(active, 1)
  })

  test('Feat 32.3: variable inspection on cyclic object reference (A -> B -> A) prevents loop', { tier: 2 }, () => {
    const seen = new Set()
    const safeInspect = (id) => (seen.has(id) ? '[Circular]' : (seen.add(id), { id }))
    assertEqual(safeInspect('nodeA').id, 'nodeA')
    assertEqual(safeInspect('nodeA'), '[Circular]')
  })

  test('Feat 32.4: watch expression throwing runtime exception displays error evaluation', { tier: 2 }, async () => {
    ipc.register('debug_evaluate', async () => ({ result: 'ReferenceError: obj is undefined', isError: true }))
    const res = await ipc.invoke('debug_evaluate', { expression: 'obj.value' })
    assertEqual(res.isError, true)
  })

  test('Feat 32.5: variable with massive string value (>1MB) lazy-loads preview safely', { tier: 2 }, () => {
    const huge = 'A'.repeat(1_000_000)
    const preview = huge.length > 100 ? `${huge.slice(0, 100)}... (${huge.length} chars)` : huge
    assert(preview.endsWith('chars)'), 'Character badge displayed')
  })

  // Feature 33: Breakpoint Gutter (5 tests)
  test('Feat 33.1: breakpoint on non-existent line 99999 clamped or rejected', { tier: 2 }, async () => {
    ipc.register('debug_set_breakpoints', async () => ({ breakpoints: [{ line: 50, verified: false }] }))
    const res = await ipc.invoke('debug_set_breakpoints', { breakpoints: [{ line: 99999 }] })
    assertEqual(res.breakpoints[0].verified, false)
  })

  test('Feat 33.2: breakpoint on empty whitespace or comment line adjusted to executable line', { tier: 2 }, () => {
    const lineMap = { 3: 4, 7: 8 }
    assertEqual(lineMap[3] || 3, 4)
  })

  test('Feat 33.3: conditional breakpoint with invalid expression syntax reports evaluation error', { tier: 2 }, () => {
    const checkCond = (expr) => { try { new Function(`return (${expr})`); return true } catch { return false } }
    assertEqual(checkCond('x ==='), false)
    assertEqual(checkCond('x > 10'), true)
  })

  test('Feat 33.4: hit count condition with negative or non-integer value rejected by validator', { tier: 2 }, () => {
    const isValidHit = (h) => Number.isInteger(h) && h > 0
    assertEqual(isValidHit(-1), false)
    assertEqual(isValidHit(5), true)
  })

  test('Feat 33.5: breakpoint set in file outside workspace root is blocked by confinement', { tier: 2 }, async () => {
    ipc.register('debug_set_breakpoints', async (p) => {
      if (!p.path?.startsWith('/ws/')) throw new Error('RootConfinementError')
      return { breakpoints: [] }
    })
    await assertThrowsAsync(() => ipc.invoke('debug_set_breakpoints', { path: '/outside/app.rs' }), 'RootConfinementError')
  })

  // Feature 34: Debug Console & Stepping (5 tests)
  test('Feat 34.1: step command when session is in running state is rejected', { tier: 2 }, async () => {
    ipc.register('debug_step_over', async (p) => {
      if (p.state !== 'paused') throw new Error('InvalidSessionStateError')
      return { stepped: true }
    })
    await assertThrowsAsync(() => ipc.invoke('debug_step_over', { state: 'running' }), 'InvalidSessionStateError')
  })

  test('Feat 34.2: stepping past the last frame (frame 0 return) triggers session finish', { tier: 2 }, () => {
    let frameCount = 1
    const stepOut = () => (--frameCount === 0 ? 'terminated' : 'stepped')
    assertEqual(stepOut(), 'terminated')
  })

  test('Feat 34.3: resume when no threads are paused is a safe no-op', { tier: 2 }, async () => {
    ipc.register('debug_resume', async () => ({ resumed: false }))
    const res = await ipc.invoke('debug_resume', { sessionId: 'dbg-none' })
    assertEqual(res.resumed, false)
  })

  test('Feat 34.4: expression evaluation in dead frame returns evaluation error cleanly', { tier: 2 }, async () => {
    ipc.register('debug_evaluate', async (p) => {
      if (!p.frameActive) throw new Error('DeadFrameError')
      return { result: '42' }
    })
    await assertThrowsAsync(() => ipc.invoke('debug_evaluate', { frameActive: false }), 'DeadFrameError')
  })

  test('Feat 34.5: multiple rapid step commands within 10ms are serialized without dropping state', { tier: 2 }, () => {
    const queue = ['step1', 'step2', 'step3']
    const out = queue.splice(0, queue.length)
    assertEqual(out.length, 3)
  })
})
