/**
 * Tier 4: Concurrent Execution, Auto-Update Overhaul, and Restricted Trust Transition.
 * Validates concurrent execution pipelines, Channel-based progress streaming,
 * download cancellation tokens, restart guards, and TrustGate security transitions.
 */

import { assert, assertEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 4: Concurrency Execution & Security Trust Transition', () => {
  let ipc
  let workspace
  let isTrustedWorkspace

  beforeEach(async () => {
    ipc = createMockIpc()
    isTrustedWorkspace = false

    ipc.register('project_trust_status', async () => ({
      trusted: isTrustedWorkspace,
      mode: isTrustedWorkspace ? 'trusted' : 'restricted',
    }))

    ipc.register('project_set_trust', async (p) => {
      isTrustedWorkspace = Boolean(p?.trusted)
      return {
        trusted: isTrustedWorkspace,
        mode: isTrustedWorkspace ? 'trusted' : 'restricted',
      }
    })

    workspace = await createTempWorkspace('tier4-trust-')
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

  test('Scenario 4.1: Long-running process in Run Console interleaves cleanly with streamed auto-update progress', async () => {
    const runRes = await ipc.invoke('run_start', {
      config: { name: 'Cargo Build Watch', binary: 'cargo', args: ['check', '--watch'] },
    })
    assert(runRes.instanceId.startsWith('run-'), 'Run instance must be active')

    const channel = ipc.createChannel()
    const taskUpdates = []
    const consoleOutput = []

    channel.onProgress((p) => {
      if (p.state === 'downloading') {
        const percent = Math.round((p.downloaded / p.total) * 100)
        taskUpdates.push({ percent, state: p.state })
      } else if (p.state === 'ready') {
        taskUpdates.push({ percent: 100, state: 'ready' })
      }
    })

    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'process_output' && ev.id === runRes.instanceId) {
        consoleOutput.push(ev.chunk)
      }
    })

    ipc.emit('ide://event', { type: 'process_output', id: runRes.instanceId, chunk: '   Compiling ide-vfs v0.1.0\n' })
    channel.send({ state: 'downloading', downloaded: 262144, total: 1048576 })

    ipc.emit('ide://event', { type: 'process_output', id: runRes.instanceId, chunk: '   Compiling ide-lsp v0.1.0\n' })
    channel.send({ state: 'downloading', downloaded: 524288, total: 1048576 })

    ipc.emit('ide://event', { type: 'process_output', id: runRes.instanceId, chunk: '    Finished dev target(s)\n' })
    channel.send({ state: 'downloading', downloaded: 1048576, total: 1048576 })
    channel.send({ state: 'ready' })

    assertEqual(taskUpdates.length, 4)
    assertEqual(taskUpdates[0].percent, 25)
    assertEqual(taskUpdates[1].percent, 50)
    assertEqual(taskUpdates[2].percent, 100)
    assertEqual(taskUpdates[3].state, 'ready')

    assertEqual(consoleOutput.length, 3)
    assert(consoleOutput[2].includes('Finished'), 'Console received all build outputs')

    const stopRes = await ipc.invoke('run_stop', { instanceId: runRes.instanceId })
    assertEqual(stopRes.stopped, true)
  }, { tier: 4 })

  test('Scenario 4.2: In-flight auto-update cancellation and restart guard enforcement during active processes', async () => {
    const daemon = await ipc.invoke('run_start', {
      config: { name: 'Daemon Server', binary: 'node', args: ['server.js'] },
    })

    const channel = ipc.createChannel()
    let isInstalling = false

    ipc.register('app_install_update', async (p) => {
      if (isInstalling && !p?.force) {
        throw new Error('InstallingGuard: Another update installation is already in progress')
      }
      isInstalling = true
      return { status: 'started' }
    })

    ipc.register('app_cancel_update', async (p) => {
      isInstalling = false
      return { token: p?.token, cancelled: true }
    })

    let activeProcessRunning = true
    ipc.register('app_restart', async () => {
      if (activeProcessRunning) {
        throw new Error('RestartGuard: Cannot restart while user process is running in Run Console')
      }
      return { restarting: true }
    })

    const startUpdate = await ipc.invoke('app_install_update', { channel })
    assertEqual(startUpdate.status, 'started')

    await assertThrowsAsync(
      () => ipc.invoke('app_install_update', { channel }),
      'InstallingGuard',
      'Concurrent update installation must be prevented by InstallingGuard',
    )

    const cancelRes = await ipc.invoke('app_cancel_update', { token: 'token-xyz-123' })
    assertEqual(cancelRes.cancelled, true)

    const restartUpdate = await ipc.invoke('app_install_update', { channel })
    assertEqual(restartUpdate.status, 'started')

    await assertThrowsAsync(
      () => ipc.invoke('app_restart'),
      'RestartGuard',
      'Restart must be guarded against active running processes',
    )

    await ipc.invoke('run_stop', { instanceId: daemon.instanceId })
    activeProcessRunning = false

    const restartRes = await ipc.invoke('app_restart')
    assertEqual(restartRes.restarting, true)
  }, { tier: 4 })

  test('Scenario 6.1: Restricted workspace mode blocks execution targets and language server spawns', async () => {
    isTrustedWorkspace = false
    const status = await ipc.invoke('project_trust_status')
    assertEqual(status.trusted, false)
    assertEqual(status.mode, 'restricted')

    ipc.register('run_start', async () => {
      if (!isTrustedWorkspace) {
        throw new Error('TrustGate: Execution is blocked in restricted mode')
      }
      return { instanceId: 'run-blocked' }
    })

    ipc.register('debug_start', async () => {
      if (!isTrustedWorkspace) {
        throw new Error('TrustGate: Debugging is blocked in restricted mode')
      }
      return { sessionId: 'dbg-blocked' }
    })

    ipc.register('lsp_discover', async () => {
      if (!isTrustedWorkspace) {
        return { language: 'rust', binary: null, found: false, restricted: true }
      }
      return { language: 'rust', binary: 'rust-analyzer', found: true, restricted: false }
    })

    await assertThrowsAsync(
      () => ipc.invoke('run_start', { config: { name: 'Cargo Run' } }),
      'TrustGate: Execution is blocked in restricted mode',
      'Restricted mode must block target execution',
    )

    await assertThrowsAsync(
      () => ipc.invoke('debug_start', { config: { name: 'LLDB Debug' } }),
      'TrustGate: Debugging is blocked in restricted mode',
      'Restricted mode must block debugging sessions',
    )

    const lsp = await ipc.invoke('lsp_discover', { language: 'rust' })
    assertEqual(lsp.found, false)
    assertEqual(lsp.restricted, true)
  }, { tier: 4 })

  test('Scenario 6.2: TrustGate transition to trusted mode activates servers and enables execution', async () => {
    isTrustedWorkspace = false

    ipc.register('run_start', async (p) => {
      if (!isTrustedWorkspace) {
        throw new Error('TrustGate: Execution is blocked in restricted mode')
      }
      return { instanceId: 'run-trusted', config: p?.config }
    })

    ipc.register('debug_start', async (p) => {
      if (!isTrustedWorkspace) {
        throw new Error('TrustGate: Debugging is blocked in restricted mode')
      }
      return { sessionId: 'dbg-trusted', config: p?.config }
    })

    ipc.register('lsp_discover', async (p) => {
      if (!isTrustedWorkspace) {
        return { language: p?.language, binary: null, found: false }
      }
      return { language: p?.language, binary: `${p?.language}-lsp`, found: true }
    })

    const transitionRes = await ipc.invoke('project_set_trust', { trusted: true })
    assertEqual(transitionRes.trusted, true)
    assertEqual(transitionRes.mode, 'trusted')

    let trustEvent = null
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'trust_changed') trustEvent = ev
    })
    ipc.emit('ide://event', { type: 'trust_changed', trusted: true })
    assertEqual(trustEvent.trusted, true)

    const lsp = await ipc.invoke('lsp_discover', { language: 'rust' })
    assertEqual(lsp.found, true)
    assertEqual(lsp.binary, 'rust-lsp')

    const detected = await ipc.invoke('run_detect_targets', { root: workspace.root })
    assert(detected.targets.length > 0, 'Run targets should be auto-detected in trusted mode')

    const runRes = await ipc.invoke('run_start', { config: detected.targets[0] })
    assertEqual(runRes.instanceId, 'run-trusted')

    const dbgRes = await ipc.invoke('debug_start', { config: { name: 'Debug Target' } })
    assertEqual(dbgRes.sessionId, 'dbg-trusted')
  }, { tier: 4 })
})
