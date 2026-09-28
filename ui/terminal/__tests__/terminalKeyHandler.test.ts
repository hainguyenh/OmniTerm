/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Connection } from '../../components/MainLayout'
import type { TerminalClipboard } from '../../utils/terminalClipboard'
import { createTerminalKeyHandler } from '../terminalKeyHandler'

const makeConnection = (type: Connection['type'] = 'LOCAL', shell: Connection['shell'] = 'powershell'): Connection => ({
  id: 'conn-1',
  name: 'Local PS',
  type,
  shell,
  host: 'localhost',
  port: '22',
  user: 'user',
})

const makeClipboard = (): TerminalClipboard => ({
  paste: vi.fn(async () => {}),
  pasteImage: vi.fn(async () => {}),
  pasteFiles: vi.fn(async () => {}),
  installDrop: vi.fn(),
  pasteScript: vi.fn(async () => {}),
  copySelection: vi.fn(async () => {}),
  dispose: vi.fn(),
})

describe('createTerminalKeyHandler', () => {
  beforeEach(() => {
    window.omnitermAPI = {
      ...window.omnitermAPI,
      app: { platform: 'win32' } as any,
    }
  })

  it('ignores non-keydown events', () => {
    const term = { input: vi.fn() } as unknown as Terminal
    const clipboard = makeClipboard()
    const handler = createTerminalKeyHandler({
      term,
      clipboard,
      connection: makeConnection(),
      isMac: false,
      getAgentName: () => null,
      getShortcuts: () => undefined,
      getEnterModes: () => undefined,
    })

    const event = new KeyboardEvent('keyup', { key: 'a', code: 'KeyA' })
    expect(handler(event)).toBe(true)
  })

  it('handles Ctrl+V paste shortcut', () => {
    const term = { input: vi.fn() } as unknown as Terminal
    const clipboard = makeClipboard()
    const handler = createTerminalKeyHandler({
      term,
      clipboard,
      connection: makeConnection(),
      isMac: false,
      getAgentName: () => null,
      getShortcuts: () => undefined,
      getEnterModes: () => undefined,
    })

    const event = new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, cancelable: true })
    const result = handler(event)

    expect(result).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(clipboard.paste).toHaveBeenCalledOnce()
  })

  it('handles Alt+V paste image shortcut', () => {
    const term = { input: vi.fn() } as unknown as Terminal
    const clipboard = makeClipboard()
    const handler = createTerminalKeyHandler({
      term,
      clipboard,
      connection: makeConnection(),
      isMac: false,
      getAgentName: () => 'Claude Code',
      getShortcuts: () => undefined,
      getEnterModes: () => undefined,
    })

    const event = new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', altKey: true, cancelable: true })
    const result = handler(event)

    expect(result).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(clipboard.pasteImage).toHaveBeenCalledOnce()
  })

  it('handles Shift+Enter when configured to emit ESC+CR sequence', () => {
    const term = { input: vi.fn() } as unknown as Terminal
    const clipboard = makeClipboard()
    const handler = createTerminalKeyHandler({
      term,
      clipboard,
      connection: makeConnection(),
      isMac: false,
      getAgentName: () => null,
      getShortcuts: () => undefined,
      getEnterModes: () => ({ shiftEnter: 'esc-cr', ctrlEnter: 'lf' }),
    })

    const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', shiftKey: true, cancelable: true })
    const result = handler(event)

    expect(result).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(term.input).toHaveBeenCalledWith('\x1b\r')
  })

  it('bubbles app-level chrome shortcuts to window (e.g. F11 or Ctrl+Shift+N)', () => {
    const term = { input: vi.fn() } as unknown as Terminal
    const clipboard = makeClipboard()
    const handler = createTerminalKeyHandler({
      term,
      clipboard,
      connection: makeConnection(),
      isMac: false,
      getAgentName: () => null,
      getShortcuts: () => ({ toggleAppFullscreen: 'F11' }),
      getEnterModes: () => undefined,
    })

    const event = new KeyboardEvent('keydown', { key: 'F11', code: 'F11' })
    const result = handler(event)

    expect(result).toBe(false) // returns false so xterm lets it bubble
  })

  it('returns true for ordinary keystrokes for xterm to handle', () => {
    const term = { input: vi.fn() } as unknown as Terminal
    const clipboard = makeClipboard()
    const handler = createTerminalKeyHandler({
      term,
      clipboard,
      connection: makeConnection(),
      isMac: false,
      getAgentName: () => null,
      getShortcuts: () => undefined,
      getEnterModes: () => undefined,
    })

    const event = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' })
    expect(handler(event)).toBe(true)
  })
})
