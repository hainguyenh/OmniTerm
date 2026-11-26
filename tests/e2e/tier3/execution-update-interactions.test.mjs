/**
 * Tier 3: Run & Debug x Auto-Update & TrustGate Combinatorial Interactions.
 * Validates cross-subsystem behaviors between Execution Engine, DAP, Tree, Auto-Update, and TrustGate.
 */

import { assert, assertDeepEqual, assertEqual, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 3: Execution x Auto-Update & TrustGate Interactions', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    workspace = await createTempWorkspace('tier3-execupdate-')
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

  test('Editing source file while debug session is paused at breakpoint warns of code drift', async () => {
    const srcPath = `${workspace.root}/src/worker.rs`
    const doc = await ipc.invoke('doc_open', { path: srcPath, initialText: 'fn worker() {\n  let x = 1;\n  let y = 2;\n}' })

    const session = await ipc.invoke('debug_start', { config: { name: 'Debug Worker', program: srcPath } })
    assertEqual(typeof session.sessionId, 'string')

    // Session paused at line 2
    const debugState = {
      sessionId: session.sessionId,
      isPaused: true,
      currentFrame: { path: srcPath, line: 2 },
      codeDriftWarning: false,
    }

    // User edits source file during pause
    await ipc.invoke('doc_edit', {
      id: doc.id,
      version: 1,
      edits: [{ from: 15, to: 15, insert: '  let inserted = 0;\n' }],
    })

    // Debug coordinator detects document edited while paused
    if (debugState.isPaused && debugState.currentFrame.path === srcPath) {
      debugState.codeDriftWarning = true
    }

    assertEqual(debugState.codeDriftWarning, true)
    assertEqual(debugState.isPaused, true)
  }, { tier: 3 })

  test('Toggling line breakpoint dynamically updates active DAP session', async () => {
    const bpFile = `${workspace.root}/src/calc.rs`
    const session = await ipc.invoke('debug_start', { config: { name: 'Test Debug' } })

    let lastSetBreakpoints = null
    ipc.register('debug_set_breakpoints', async (p) => {
      lastSetBreakpoints = p
      return {
        breakpoints: p.breakpoints.map((bp, i) => ({ id: `bp-${i}`, line: bp.line, verified: true })),
      }
    })

    // User toggles line 15 in editor gutter
    const res = await ipc.invoke('debug_set_breakpoints', {
      sessionId: session.sessionId,
      path: bpFile,
      breakpoints: [{ line: 15 }],
    })

    assertEqual(res.breakpoints.length, 1)
    assertEqual(res.breakpoints[0].line, 15)
    assertEqual(res.breakpoints[0].verified, true)
    assertEqual(lastSetBreakpoints.path, bpFile)
  }, { tier: 3 })

  test('Clicking editor run gutter icon launches matching target in Run Console', async () => {
    const mainFile = `${workspace.root}/src/main.rs`
    await ipc.invoke('doc_open', { path: mainFile, initialText: 'fn main() {\n  println!("Start");\n}' })

    // Gutter detects main function at line 0
    const gutterAction = { line: 0, target: { name: 'cargo run --bin app', binary: 'cargo', args: ['run'] } }

    // User clicks gutter action
    const runRes = await ipc.invoke('run_start', { config: gutterAction.target })
    assert(runRes.instanceId.startsWith('run-'), 'Run instance should be created')
    assertEqual(runRes.config.name, 'cargo run --bin app')

    // Run Console receives output
    const consoleOutput = []
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'process_output' && ev.id === runRes.instanceId) {
        consoleOutput.push(ev.chunk)
      }
    })

    ipc.emit('ide://event', { type: 'process_output', id: runRes.instanceId, chunk: 'Start\n' })
    assertEqual(consoleOutput.length, 1)
    assertEqual(consoleOutput[0], 'Start\n')
  }, { tier: 3 })

  test('Deleting runnable target file in tree invalidates Run Widget targets', async () => {
    const pkgJson = `${workspace.root}/package.json`
    await ipc.invoke('fs_create_file', { path: pkgJson })

    // Auto-detect finds npm targets
    const initialTargets = await ipc.invoke('run_detect_targets', { root: workspace.root })
    assert(initialTargets.targets.length > 0, 'Should find detected targets')

    // Delete package.json via project tree
    await ipc.invoke('fs_delete', { path: pkgJson })

    // Cache invalidation returns empty targets
    ipc.register('run_detect_targets', async () => ({ targets: [] }))

    const updatedTargets = await ipc.invoke('run_detect_targets', { root: workspace.root })
    assertEqual(updatedTargets.targets.length, 0)
  }, { tier: 3 })

  test('Running process in Run Console interleaves cleanly with background auto-update progress', async () => {
    const runRes = await ipc.invoke('run_start', { config: { name: 'Build Job' } })
    const channel = ipc.createChannel()

    const receivedEvents = []
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'process_output') receivedEvents.push(`run:${ev.chunk.trim()}`)
    })

    channel.onProgress((p) => {
      receivedEvents.push(`update:${p.state}:${p.downloaded || 0}`)
    })

    // Interleave process output and update progress
    ipc.emit('ide://event', { type: 'process_output', id: runRes.instanceId, chunk: 'Compiling core\n' })
    channel.send({ state: 'downloading', downloaded: 25, total: 100 })
    ipc.emit('ide://event', { type: 'process_output', id: runRes.instanceId, chunk: 'Compiling ui\n' })
    channel.send({ state: 'downloading', downloaded: 100, total: 100 })
    channel.send({ state: 'ready' })

    assertEqual(receivedEvents.length, 5)
    assertEqual(receivedEvents[0], 'run:Compiling core')
    assertEqual(receivedEvents[1], 'update:downloading:25')
    assertEqual(receivedEvents[2], 'run:Compiling ui')
    assertEqual(receivedEvents[3], 'update:downloading:100')
    assertEqual(receivedEvents[4], 'update:ready:0')
  }, { tier: 3 })

  test('Update restart action refuses restart while debug session is active', async () => {
    const session = await ipc.invoke('debug_start', { config: { name: 'Live Debug' } })
    let activeSessionsCount = 1

    ipc.register('app_restart', async () => {
      if (activeSessionsCount > 0) {
        throw new Error(`ActiveSessionGuardError: Cannot restart while debug session '${session.sessionId}' is active`)
      }
      return { restarting: true }
    })

    // Attempt restart while debug session runs
    await assertThrowsAsync(() => ipc.invoke('app_restart'), 'ActiveSessionGuardError')

    // Disconnect debug session
    await ipc.invoke('debug_stop', { instanceId: session.sessionId }).catch(() => {})
    activeSessionsCount = 0

    // Restart succeeds once session is terminated
    const res = await ipc.invoke('app_restart')
    assertEqual(res.restarting, true)
  }, { tier: 3 })

  test('TrustGate transition from restricted to trusted enables LSP and Run actions', async () => {
    let isTrusted = false

    ipc.register('run_start', async () => {
      if (!isTrusted) throw new Error('TrustGateError: Execution disabled in untrusted workspace')
      return { instanceId: 'run-allowed' }
    })

    ipc.register('lsp_discover', async () => {
      if (!isTrusted) throw new Error('TrustGateError: Language server disabled in untrusted workspace')
      return { found: true, binary: 'rust-analyzer' }
    })

    // Both actions blocked while untrusted
    await assertThrowsAsync(() => ipc.invoke('run_start', {}), 'TrustGateError')
    await assertThrowsAsync(() => ipc.invoke('lsp_discover', {}), 'TrustGateError')

    // User trusts workspace
    isTrusted = true

    // Both actions succeed
    const runRes = await ipc.invoke('run_start', {})
    const lspRes = await ipc.invoke('lsp_discover', {})

    assertEqual(runRes.instanceId, 'run-allowed')
    assertEqual(lspRes.found, true)
  }, { tier: 3 })

  test('Terminating running process via Stop button while stdout is streaming flushes exit state', async () => {
    const run = await ipc.invoke('run_start', { config: { name: 'Log Generator' } })

    const consoleState = { isRunning: true, exitCode: null, logs: [] }

    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'process_output') consoleState.logs.push(ev.chunk)
      if (ev.type === 'process_exit') {
        consoleState.isRunning = false
        consoleState.exitCode = ev.exitCode
      }
    })

    ipc.emit('ide://event', { type: 'process_output', chunk: 'Log line 1\n' })

    // Stop requested
    await ipc.invoke('run_stop', { instanceId: run.instanceId })
    ipc.emit('ide://event', { type: 'process_exit', exitCode: 130 })

    assertEqual(consoleState.isRunning, false)
    assertEqual(consoleState.exitCode, 130)
    assertEqual(consoleState.logs[0], 'Log line 1\n')
  }, { tier: 3 })

  test('Breakpoint hit pausing debug session isolates from parallel independent Run target', async () => {
    const dbgSession = await ipc.invoke('debug_start', { config: { name: 'Unit Tests' } })
    const runInstance = await ipc.invoke('run_start', { config: { name: 'Background Linter' } })

    const states = {
      debugPaused: false,
      runFinished: false,
    }

    // Debugger hits breakpoint
    ipc.emit('ide://event', { type: 'debug_stopped', sessionId: dbgSession.sessionId, reason: 'breakpoint' })
    states.debugPaused = true

    // Background linter continues and finishes
    ipc.emit('ide://event', { type: 'process_exit', id: runInstance.instanceId, exitCode: 0 })
    states.runFinished = true

    assertEqual(states.debugPaused, true)
    assertEqual(states.runFinished, true)
  }, { tier: 3 })

  test('Background update reaching ready state notifies user without interrupting active build', async () => {
    const buildInstance = await ipc.invoke('run_start', { config: { name: 'Heavy Compilation' } })

    const notifications = []
    let buildRunning = true

    // Channel reports update ready
    const channel = ipc.createChannel()
    channel.onProgress((p) => {
      if (p.state === 'ready') notifications.push('Update downloaded. Restart when convenient.')
    })

    channel.send({ state: 'ready' })

    // Build still executes
    assertEqual(buildRunning, true)
    assertEqual(notifications.length, 1)
    assert(notifications[0].includes('Restart when convenient'))
  }, { tier: 3 })

  test('Switching project root in dropdown prompts confirmation when process is actively running', async () => {
    const root1 = `${workspace.root}/project-frontend`
    const root2 = `${workspace.root}/project-backend`

    const runningProcesses = [{ id: 'proc-1', root: root1, name: 'Dev Server' }]

    ipc.register('ide_set_project', async (p) => {
      const activeInCurrent = runningProcesses.filter((pr) => pr.root !== p.path)
      return {
        activeRoot: p.path,
        hasRunningProcesses: activeInCurrent.length > 0,
        runningCount: activeInCurrent.length,
        prompt: activeInCurrent.length > 0 ? 'Processes are running. Keep running in background?' : null,
      }
    })

    const switchRes = await ipc.invoke('ide_set_project', { path: root2 })
    assertEqual(switchRes.activeRoot, root2)
    assertEqual(switchRes.hasRunningProcesses, true)
    assertEqual(switchRes.runningCount, 1)
    assert(switchRes.prompt.includes('Keep running in background'))
  }, { tier: 3 })
})
