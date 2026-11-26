/**
 * Opaque-box Mock IPC Command Dispatcher & Event Bus for OmniTerm.
 * Emulates Tauri IPC command invocation, event bus (ide://event), and channel streaming.
 */

import { registerAutoUpdateHandlers } from './mock-ipc-updater.mjs'

export class MockIpc {
  constructor() {
    this.handlers = new Map()
    this.listeners = new Map()
    this.calls = []
    this.initDefaultHandlers()
  }

  initDefaultHandlers() {
    this.idCounter = 0
    // Document registry defaults
    this.register('doc_open', async (payload) => ({
      id: `doc-${++this.idCounter}-${Date.now()}`,
      path: payload?.path || '',
      text: payload?.initialText ?? '',
      version: 1,
      encoding: 'utf-8',
      lineEnding: 'lf',
      mode: 'text',
      language: payload?.path?.endsWith('.rs') ? 'rust' : 'plaintext',
    }))

    this.register('doc_edit', async (payload) => ({
      id: payload?.id,
      version: (payload?.version || 1) + 1,
    }))

    this.register('doc_save', async (payload) => ({
      id: payload?.id,
      success: true,
      savedAt: Date.now(),
    }))

    this.register('doc_close', async (payload) => ({
      id: payload?.id,
      closed: true,
    }))

    this.register('doc_sync_from_disk', async (payload) => ({
      id: payload?.id,
      status: 'reloaded',
      externalVersion: 1,
    }))

    // VFS defaults
    this.register('fs_read_dir', async (payload) => [
      { name: 'src', isDir: true, path: `${payload?.path}/src` },
      { name: 'package.json', isDir: false, path: `${payload?.path}/package.json` },
    ])

    this.register('fs_create_file', async (payload) => ({
      name: payload?.path?.split('/')?.pop() || 'new-file',
      path: payload?.path,
      isDir: false,
    }))

    this.register('fs_create_dir', async (payload) => ({
      name: payload?.path?.split('/')?.pop() || 'new-dir',
      path: payload?.path,
      isDir: true,
    }))

    this.register('fs_delete', async (payload) => ({
      path: payload?.path,
      deleted: true,
    }))

    this.register('fs_rename', async (payload) => ({
      from: payload?.from,
      to: payload?.to,
      renamed: true,
    }))

    this.register('ide_set_project', async (payload) => ({
      path: payload?.path || '',
      success: Boolean(payload?.path),
      activeRoot: payload?.path,
    }))

    // LSP defaults
    this.register('lsp_discover', async (payload) => ({
      language: payload?.language || 'rust',
      binary: payload?.binary || `${payload?.language || 'rust'}-analyzer`,
      found: payload?.found ?? true,
      path: payload?.found === false ? null : `/usr/bin/${payload?.language || 'rust'}-lsp`,
    }))

    this.register('lsp_hover', async (payload) => ({
      contents: payload?.contents || 'fn test() -> ()',
      range: payload?.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
    }))

    this.register('lsp_completion', async (payload) => ({
      items: payload?.items || [
        { label: 'println!', kind: 3, detail: 'macro println' },
        { label: 'print!', kind: 3, detail: 'macro print' },
      ],
      isIncomplete: false,
    }))

    this.register('lsp_definition', async (payload) => [
      { uri: `file://${payload?.path || '/workspace/src/main.rs'}`, range: { start: { line: 10, character: 0 }, end: { line: 10, character: 8 } } },
    ])

    this.register('lsp_references', async (payload) => [
      { uri: `file://${payload?.path || '/workspace/src/main.rs'}`, range: { start: { line: 10, character: 0 }, end: { line: 10, character: 8 } } },
      { uri: `file://${payload?.otherPath || '/workspace/src/lib.rs'}`, range: { start: { line: 5, character: 4 }, end: { line: 5, character: 12 } } },
    ])

    this.register('lsp_prepare_rename', async (payload) => ({
      range: { start: { line: payload?.line || 0, character: 0 }, end: { line: payload?.line || 0, character: 8 } },
      placeholder: payload?.newName || 'new_name',
    }))

    this.register('apply_workspace_edit', async (payload) => ({
      applied: true,
      changes: payload?.changes || {},
    }))

    this.register('lsp_status', async (payload) => ({
      language: payload?.language || 'rust',
      status: payload?.status || 'ready',
    }))

    // Run / Debug defaults
    this.register('run_configs_read', async (payload) => ({
      configs: [
        { name: 'Run Main', binary: 'cargo', args: ['run'], cwd: payload?.root || '/workspace' },
      ],
    }))

    this.register('run_configs_write', async (payload) => ({
      success: true,
      count: payload?.configs?.length || 0,
    }))

    this.register('run_detect_targets', async (payload) => ({
      targets: [
        { name: 'cargo run', kind: 'cargo', file: `${payload?.root || '/workspace'}/Cargo.toml` },
        { name: 'npm test', kind: 'npm', file: `${payload?.root || '/workspace'}/package.json` },
      ],
    }))

    this.register('run_start', async (payload) => ({
      instanceId: `run-${Date.now()}`,
      config: payload?.config,
      pid: 12345,
    }))

    this.register('run_stop', async (payload) => ({
      instanceId: payload?.instanceId,
      stopped: true,
    }))

    this.register('debug_start', async (payload) => ({
      sessionId: `dbg-${Date.now()}`,
      config: payload?.config,
      adapter: payload?.adapter || 'node-debug2',
    }))

    this.register('debug_set_breakpoints', async (payload) => ({
      breakpoints: (payload?.breakpoints || []).map((bp) => ({
        id: `bp-${Math.random().toString(36).slice(2, 7)}`,
        line: bp.line,
        verified: true,
        condition: bp.condition,
        hitCondition: bp.hitCondition,
      })),
    }))

    this.register('debug_step_over', async (payload) => ({
      sessionId: payload?.sessionId,
      stepped: true,
    }))

    this.register('debug_step_into', async (payload) => ({
      sessionId: payload?.sessionId,
      stepped: true,
    }))

    this.register('debug_resume', async (payload) => ({
      sessionId: payload?.sessionId,
      resumed: true,
    }))

    this.register('debug_evaluate', async (payload) => ({
      result: payload?.expression === 'x' ? '42' : '()',
      type: 'i32',
    }))

    // Auto-update defaults
    registerAutoUpdateHandlers(this)
  }

  register(command, handler) {
    this.handlers.set(command, handler)
  }

  unregister(command) {
    this.handlers.delete(command)
  }

  async invoke(command, payload) {
    const record = { command, payload, timestamp: Date.now() }
    this.calls.push(record)

    const handler = this.handlers.get(command)
    if (!handler) {
      const err = new Error(`Command '${command}' not registered in MockIpc`)
      record.error = err
      throw err
    }

    try {
      const result = await handler(payload)
      record.result = result
      return result
    } catch (err) {
      record.error = err
      throw err
    }
  }

  listen(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event).add(callback)
    return () => this.listeners.get(event)?.delete(callback)
  }

  emit(event, payload) {
    const callbacks = this.listeners.get(event)
    if (!callbacks || callbacks.size === 0) return
    for (const cb of Array.from(callbacks)) {
      try {
        cb(payload)
      } catch (err) {
        console.error(`Error in MockIpc listener for ${event}:`, err)
      }
    }
  }

  createChannel() {
    const listeners = new Set()
    return {
      send: (data) => {
        for (const fn of listeners) fn(data)
      },
      onProgress: (fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }
  }

  getCalls(command) {
    return command ? this.calls.filter((c) => c.command === command) : [...this.calls]
  }

  assertCalled(command, times = null) {
    const matches = this.getCalls(command)
    if (times === null) {
      if (matches.length === 0) {
        throw new Error(`Expected command '${command}' to be called, but was never called`)
      }
    } else if (matches.length !== times) {
      throw new Error(`Expected command '${command}' to be called ${times} times, but called ${matches.length} times`)
    }
  }

  assertNotCalled(command) {
    const matches = this.getCalls(command)
    if (matches.length > 0) {
      throw new Error(`Expected command '${command}' not to be called, but called ${matches.length} times`)
    }
  }

  resetHistory() {
    this.calls = []
  }

  reset() {
    this.handlers.clear()
    this.listeners.clear()
    this.calls = []
    this.isInstalling = false
    this.isRestarting = false
    this.announcedVersions = new Set()
    this.initDefaultHandlers()
  }

  clear() {
    this.reset()
  }
}

export function createMockIpc() {
  return new MockIpc()
}
