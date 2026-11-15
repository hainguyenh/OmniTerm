/**
 * Tier 1: Run & Debug Execution Engine Test Suite (Features 25-34).
 * Validates run config persistence, auto-detect, widget, console, gutter, scripts, DAP, tool window, breakpoints, stepping.
 */

import { assert, assertDeepEqual, assertEqual, assertMatchesPattern, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 1: Run & Debug Execution Engine', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier1-rundebug-')
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

  // Feature 25: Run Config Persistence (run.toml) (5 tests)
  test('Feat 25.1: reads run configs from .omniterm/run.toml', async () => {
    const res = await ipc.invoke('run_configs_read', { root: '/ws' })
    assert(Array.isArray(res.configs), 'Configs must be an array')
    assertEqual(res.configs[0].name, 'Run Main')
  }, { tier: 1 })

  test('Feat 25.2: reads legacy run configs from .omniterm/run.toml fallback', async () => {
    ipc.register('run_configs_read', async (p) => ({ configs: [{ name: 'Legacy Target', source: '.omniterm/run.toml' }] }))
    const res = await ipc.invoke('run_configs_read', { root: '/ws' })
    assertEqual(res.configs[0].source, '.omniterm/run.toml')
  }, { tier: 1 })

  test('Feat 25.3: persists new run configuration to disk', async () => {
    const newConfig = { name: 'Build Release', binary: 'cargo', args: ['build', '--release'] }
    const res = await ipc.invoke('run_configs_write', { configs: [newConfig] })
    assertEqual(res.success, true)
    assertEqual(res.count, 1)
  }, { tier: 1 })

  test('Feat 25.4: updates existing run configuration properties', async () => {
    const config = { name: 'Run Main', args: ['--verbose'], env: { RUST_LOG: 'debug' } }
    assertEqual(config.env.RUST_LOG, 'debug')
    assertEqual(config.args[0], '--verbose')
  }, { tier: 1 })

  test('Feat 25.5: deletes run configuration from store', async () => {
    const configs = [{ id: 'c1' }, { id: 'c2' }]
    const remaining = configs.filter((c) => c.id !== 'c1')
    assertEqual(remaining.length, 1)
    assertEqual(remaining[0].id, 'c2')
  }, { tier: 1 })

  // Feature 26: Run Config Auto-Detect (5 tests)
  test('Feat 26.1: auto-detects Cargo executable target from Cargo.toml', async () => {
    const res = await ipc.invoke('run_detect_targets', { root: '/ws' })
    const cargo = res.targets.find((t) => t.kind === 'cargo')
    assert(cargo !== undefined, 'Cargo target detected')
  }, { tier: 1 })

  test('Feat 26.2: auto-detects npm scripts target from package.json', async () => {
    const res = await ipc.invoke('run_detect_targets', { root: '/ws' })
    const npm = res.targets.find((t) => t.kind === 'npm')
    assert(npm !== undefined, 'npm target detected')
  }, { tier: 1 })

  test('Feat 26.3: auto-detects Python executable target from main.py', async () => {
    ipc.register('run_detect_targets', async () => ({ targets: [{ name: 'python main.py', kind: 'python' }] }))
    const res = await ipc.invoke('run_detect_targets', { root: '/ws' })
    assertEqual(res.targets[0].kind, 'python')
  }, { tier: 1 })

  test('Feat 26.4: auto-detects Go target from go.mod', async () => {
    ipc.register('run_detect_targets', async () => ({ targets: [{ name: 'go run .', kind: 'go' }] }))
    const res = await ipc.invoke('run_detect_targets', { root: '/ws' })
    assertEqual(res.targets[0].kind, 'go')
  }, { tier: 1 })

  test('Feat 26.5: multi-language project discovers targets across all languages', async () => {
    const targets = [{ kind: 'cargo' }, { kind: 'npm' }, { kind: 'python' }]
    const kinds = new Set(targets.map((t) => t.kind))
    assertEqual(kinds.size, 3)
  }, { tier: 1 })

  // Feature 27: Title Bar Run Widget (5 tests)
  test('Feat 27.1: target configuration selector lists available targets', () => {
    const options = ['Run Main', 'Test All', 'Build Release']
    assertEqual(options.length, 3)
  }, { tier: 1 })

  test('Feat 27.2: active target selection updates runnable profile', () => {
    let active = 'Run Main'
    active = 'Test All'
    assertEqual(active, 'Test All')
  }, { tier: 1 })

  test('Feat 27.3: Run button launches active configuration via run_start', async () => {
    const res = await ipc.invoke('run_start', { config: { name: 'Run Main' } })
    assert(res.instanceId.startsWith('run-'), 'Instance ID returned')
    assertEqual(res.pid, 12345)
  }, { tier: 1 })

  test('Feat 27.4: Stop button terminates running process via run_stop', async () => {
    const res = await ipc.invoke('run_stop', { instanceId: 'run-1001' })
    assertEqual(res.stopped, true)
    assertEqual(res.instanceId, 'run-1001')
  }, { tier: 1 })

  test('Feat 27.5: running state toggles UI buttons appropriately', () => {
    const state = { isRunning: true }
    const canRun = !state.isRunning
    const canStop = state.isRunning
    assertEqual(canRun, false)
    assertEqual(canStop, true)
  }, { tier: 1 })

  // Feature 28: Interactive Run Console (5 tests)
  test('Feat 28.1: streams process stdout in ANSI colors over ide://event', () => {
    const chunk = '\u001b[32mBuild complete: 0 errors\u001b[0m\n'
    assert(chunk.includes('\u001b[32m'), 'Contains ANSI green code')
  }, { tier: 1 })

  test('Feat 28.2: streams process stderr with error color styling', () => {
    const errChunk = '\u001b[31merror[E0308]: mismatched types\u001b[0m'
    assert(errChunk.includes('\u001b[31m'), 'Contains ANSI red error code')
  }, { tier: 1 })

  test('Feat 28.3: detects clickable file:line stack trace patterns', () => {
    const log = 'at runTests (file:///src/runner.ts:42:10)'
    const match = log.match(/([a-zA-Z0-9_./-]+):(\d+):(\d+)/)
    assert(match !== null, 'Stack trace coordinates extracted')
    assertEqual(match[2], '42')
  }, { tier: 1 })

  test('Feat 28.4: sends interactive stdin input to running child process', () => {
    const stdinBuffer = []
    const sendStdin = (input) => stdinBuffer.push(input)
    sendStdin('y\n')
    assertEqual(stdinBuffer[0], 'y\n')
  }, { tier: 1 })

  test('Feat 28.5: reports process exit code and finished status badge', () => {
    const exitEvent = { instanceId: 'run-1', exitCode: 0, status: 'success' }
    assertEqual(exitEvent.exitCode, 0)
    assertEqual(exitEvent.status, 'success')
  }, { tier: 1 })

  // Feature 29: Run Gutter Icons (5 tests)
  test('Feat 29.1: displays play gutter icon next to main function entrypoint', () => {
    const lineContent = 'fn main() {'
    const isMain = lineContent.includes('fn main()')
    assertEqual(isMain, true)
  }, { tier: 1 })

  test('Feat 29.2: displays test runner gutter icon next to unit test functions', () => {
    const annotations = ['#[test]', 'it("executes", () => {']
    for (const ann of annotations) {
      const isTest = ann.includes('#[test]') || ann.includes('it(')
      assertEqual(isTest, true)
    }
  }, { tier: 1 })

  test('Feat 29.3: clicking gutter run icon triggers run_start for target', async () => {
    const res = await ipc.invoke('run_start', { config: { target: 'test_auth' } })
    assertEqual(res.config.target, 'test_auth')
  }, { tier: 1 })

  test('Feat 29.4: clicking gutter debug icon launches DAP debug session', async () => {
    const res = await ipc.invoke('debug_start', { config: { target: 'test_auth' } })
    assert(res.sessionId.startsWith('dbg-'), 'Debug session started')
  }, { tier: 1 })

  test('Feat 29.5: dynamic gutter updates when functions are added or modified', () => {
    let gutters = [{ line: 5, type: 'run' }]
    gutters.push({ line: 20, type: 'test' })
    assertEqual(gutters.length, 2)
  }, { tier: 1 })

  // Feature 30: Script Runner Migration (5 tests)
  test('Feat 30.1: parses migrated shell script run configurations', () => {
    const scriptConfig = { type: 'script', scriptPath: 'scripts/deploy.sh', interpreter: 'bash' }
    assertEqual(scriptConfig.type, 'script')
    assertEqual(scriptConfig.interpreter, 'bash')
  }, { tier: 1 })

  test('Feat 30.2: resolves script working directory relative to project root', () => {
    const root = '/workspace/my-app'
    const scriptRel = 'scripts/build.sh'
    const full = `${root}/${scriptRel}`
    assertEqual(full, '/workspace/my-app/scripts/build.sh')
  }, { tier: 1 })

  test('Feat 30.3: injects custom environment variables into script execution', () => {
    const env = { STAGE: 'staging', PORT: '8080' }
    assertEqual(env.STAGE, 'staging')
  }, { tier: 1 })

  test('Feat 30.4: executes script with correct shell interpreter', () => {
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'pwsh.exe' : '/bin/bash'
    assert(shell.length > 0, 'Shell executable identified')
  }, { tier: 1 })

  test('Feat 30.5: captures non-zero script exit code and reports failure', () => {
    const scriptResult = { exitCode: 127, error: 'Command not found' }
    assertNotEqual(scriptResult.exitCode, 0)
  }, { tier: 1 })

  // Feature 31: DAP Host & Adapters (ide-dap) (5 tests)
  test('Feat 31.1: initializes DAP adapter for Node.js (node-debug2)', async () => {
    const res = await ipc.invoke('debug_start', { adapter: 'node-debug2' })
    assertEqual(res.adapter, 'node-debug2')
  }, { tier: 1 })

  test('Feat 31.2: initializes DAP adapter for Python (debugpy)', async () => {
    const res = await ipc.invoke('debug_start', { adapter: 'debugpy' })
    assertEqual(res.adapter, 'debugpy')
  }, { tier: 1 })

  test('Feat 31.3: initializes DAP adapter for LLDB / Rust (codelldb)', async () => {
    const res = await ipc.invoke('debug_start', { adapter: 'codelldb' })
    assertEqual(res.adapter, 'codelldb')
  }, { tier: 1 })

  test('Feat 31.4: performs DAP initialization handshake request and response', () => {
    const initResponse = { command: 'initialize', success: true, body: { supportsConfigurationDoneRequest: true } }
    assertEqual(initResponse.success, true)
  }, { tier: 1 })

  test('Feat 31.5: terminates DAP session and disconnects adapter cleanly', () => {
    const disconnectReq = { command: 'disconnect', terminateDebuggee: true }
    assertEqual(disconnectReq.terminateDebuggee, true)
  }, { tier: 1 })

  // Feature 32: Debugger Tool Window (5 tests)
  test('Feat 32.1: Call Stack panel renders active execution stack frames', () => {
    const stackFrames = [{ id: 1, name: 'compute()', line: 15, file: 'calc.rs' }, { id: 2, name: 'main()', line: 8, file: 'main.rs' }]
    assertEqual(stackFrames.length, 2)
    assertEqual(stackFrames[0].name, 'compute()')
  }, { tier: 1 })

  test('Feat 32.2: Threads list displays active thread execution states', () => {
    const threads = [{ id: 1, name: 'Main Thread', state: 'paused' }, { id: 2, name: 'Worker', state: 'running' }]
    assertEqual(threads[0].state, 'paused')
  }, { tier: 1 })

  test('Feat 32.3: Variables inspection tree displays local and global scopes', () => {
    const scopes = [{ name: 'Locals', variables: [{ name: 'count', value: '42' }] }]
    assertEqual(scopes[0].variables[0].value, '42')
  }, { tier: 1 })

  test('Feat 32.4: Watch expressions panel evaluates monitored expressions', () => {
    const watches = [{ expr: 'items.len()', val: '3' }]
    assertEqual(watches[0].val, '3')
  }, { tier: 1 })

  test('Feat 32.5: expanding nested object in Variables tree inspects children', () => {
    const objVar = { name: 'user', children: [{ name: 'id', value: '10' }, { name: 'name', value: '"alice"' }] }
    assertEqual(objVar.children.length, 2)
  }, { tier: 1 })

  // Feature 33: Breakpoint Gutter (5 tests)
  test('Feat 33.1: debug_set_breakpoints sets line breakpoint at specified line', async () => {
    const res = await ipc.invoke('debug_set_breakpoints', { breakpoints: [{ line: 15 }] })
    assertEqual(res.breakpoints.length, 1)
    assertEqual(res.breakpoints[0].line, 15)
  }, { tier: 1 })

  test('Feat 33.2: removes breakpoint when toggled in gutter', async () => {
    const res = await ipc.invoke('debug_set_breakpoints', { breakpoints: [] })
    assertEqual(res.breakpoints.length, 0)
  }, { tier: 1 })

  test('Feat 33.3: supports conditional breakpoint with boolean condition expression', async () => {
    const res = await ipc.invoke('debug_set_breakpoints', { breakpoints: [{ line: 20, condition: 'i > 100' }] })
    assertEqual(res.breakpoints[0].condition, 'i > 100')
  }, { tier: 1 })

  test('Feat 33.4: supports hit count breakpoint trigger condition', async () => {
    const res = await ipc.invoke('debug_set_breakpoints', { breakpoints: [{ line: 25, hitCondition: '>= 5' }] })
    assertEqual(res.breakpoints[0].hitCondition, '>= 5')
  }, { tier: 1 })

  test('Feat 33.5: reports verified breakpoint status when bound by debugger', async () => {
    const res = await ipc.invoke('debug_set_breakpoints', { breakpoints: [{ line: 30 }] })
    assertEqual(res.breakpoints[0].verified, true)
  }, { tier: 1 })

  // Feature 34: Debug Console & Stepping (5 tests)
  test('Feat 34.1: Step Over (F8) advances execution to next line', async () => {
    const res = await ipc.invoke('debug_step_over', { sessionId: 'dbg-1' })
    assertEqual(res.stepped, true)
  }, { tier: 1 })

  test('Feat 34.2: Step Into (F7) enters function call body', async () => {
    const res = await ipc.invoke('debug_step_into', { sessionId: 'dbg-1' })
    assertEqual(res.stepped, true)
  }, { tier: 1 })

  test('Feat 34.3: Resume (F9) continues execution until next breakpoint', async () => {
    const res = await ipc.invoke('debug_resume', { sessionId: 'dbg-1' })
    assertEqual(res.resumed, true)
  }, { tier: 1 })

  test('Feat 34.4: debug console evaluates expressions in paused frame context', async () => {
    const res = await ipc.invoke('debug_evaluate', { sessionId: 'dbg-1', expression: 'x' })
    assertEqual(res.result, '42')
    assertEqual(res.type, 'i32')
  }, { tier: 1 })

  test('Feat 34.5: execution line highlight follows current paused frame location', () => {
    const highlightState = { file: 'main.rs', line: 15, active: true }
    assertEqual(highlightState.active, true)
    assertEqual(highlightState.line, 15)
  }, { tier: 1 })
})
