/**
 * @vitest-environment jsdom
 */
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Connection } from '../../components/MainLayout'
import type { TerminalClipboard } from '../../utils/terminalClipboard'
import { setCtrlCSettings } from '../ctrlCSettings'
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
      sessionId: 's1',
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
      sessionId: 's1',
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
      sessionId: 's1',
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
      sessionId: 's1',
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
      sessionId: 's1',
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
      sessionId: 's1',
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

  describe('Ctrl+C', () => {
    const ctrlC = () => new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, cancelable: true })
    const build = (sessionId: string, term: Partial<Terminal>, extra: Partial<Parameters<typeof createTerminalKeyHandler>[0]> = {}) => {
      const clipboard = makeClipboard()
      const handler = createTerminalKeyHandler({
        sessionId,
        term: term as Terminal,
        clipboard,
        connection: makeConnection(),
        isMac: false,
        getAgentName: () => null,
        getShortcuts: () => undefined,
        getEnterModes: () => undefined,
        ...extra,
      })
      return { handler, clipboard }
    }

    it('copies and clears the selection instead of interrupting when text is selected', () => {
      const clearSelection = vi.fn()
      const { handler, clipboard } = build('cc-sel', { hasSelection: () => true, clearSelection })
      expect(handler(ctrlC())).toBe(false)
      expect(clipboard.copySelection).toHaveBeenCalled()
      expect(clearSelection).toHaveBeenCalled()
    })

    it('lets a single press through to the PTY and does not close the session', () => {
      const listener = vi.fn()
      window.addEventListener('omniterm:close-tab', listener)
      const { handler } = build('cc-single', { hasSelection: () => false })
      expect(handler(ctrlC())).toBe(true)
      window.removeEventListener('omniterm:close-tab', listener)
      expect(listener).not.toHaveBeenCalled()
    })

    it('closes the named session on a quick second press', () => {
      const listener = vi.fn()
      window.addEventListener('omniterm:close-tab', listener)
      const { handler } = build('cc-double', { hasSelection: () => false })
      handler(ctrlC())
      expect(handler(ctrlC())).toBe(false)
      window.removeEventListener('omniterm:close-tab', listener)
      expect(listener).toHaveBeenCalledTimes(1)
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'cc-double' })
    })

    it('does not treat a held key (auto-repeat) as a second press', () => {
      const listener = vi.fn()
      window.addEventListener('omniterm:close-tab', listener)
      const { handler } = build('cc-repeat', { hasSelection: () => false })
      handler(ctrlC())
      const repeat = new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, repeat: true, cancelable: true })
      expect(handler(repeat)).toBe(true)
      window.removeEventListener('omniterm:close-tab', listener)
      expect(listener).not.toHaveBeenCalled()
    })

    it('does not close an exited session on an auto-repeated Ctrl+C', () => {
      const listener = vi.fn()
      window.addEventListener('omniterm:close-tab', listener)
      const { handler } = build('cc-repeat-exited', { hasSelection: () => false }, { getExitedActions: () => ({ restart: vi.fn() }) })
      const repeat = new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, repeat: true, cancelable: true })
      expect(handler(repeat)).toBe(true)
      window.removeEventListener('omniterm:close-tab', listener)
      expect(listener).not.toHaveBeenCalled()
    })

    it('hints that a second press closes only when a lone Ctrl+C was sent through', () => {
      const onInterruptHint = vi.fn()
      const { handler } = build('cc-hint', { hasSelection: () => false }, { onInterruptHint })
      handler(ctrlC())
      expect(onInterruptHint).toHaveBeenCalledTimes(1)
      handler(ctrlC())
      expect(onInterruptHint).toHaveBeenCalledTimes(1)
    })

    it('does not hint when Ctrl+C only copies a selection', () => {
      const onInterruptHint = vi.fn()
      const { handler } = build('cc-hint-sel', { hasSelection: () => true, clearSelection: vi.fn() }, { onInterruptHint })
      handler(ctrlC())
      expect(onInterruptHint).not.toHaveBeenCalled()
    })

    it('restarts on Enter and closes on Ctrl+C once the process has exited', () => {
      const restart = vi.fn()
      const listener = vi.fn()
      window.addEventListener('omniterm:close-tab', listener)
      const { handler } = build('cc-exited', { hasSelection: () => false }, { getExitedActions: () => ({ restart }) })
      expect(handler(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', cancelable: true }))).toBe(false)
      expect(restart).toHaveBeenCalled()
      expect(handler(ctrlC())).toBe(false)
      window.removeEventListener('omniterm:close-tab', listener)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    describe('with the Ctrl+C settings', () => {
      afterEach(() => setCtrlCSettings(undefined))

      it('sends the interrupt despite a selection when set to "always interrupt"', () => {
        setCtrlCSettings({ withSelection: 'interrupt' })
        const { handler, clipboard } = build('cc-set-sel', { hasSelection: () => true, clearSelection: vi.fn() })
        expect(handler(ctrlC())).toBe(true)
        expect(clipboard.copySelection).not.toHaveBeenCalled()
      })

      it('never closes on a double press when the double press does nothing', () => {
        setCtrlCSettings({ doublePress: 'none' })
        const listener = vi.fn()
        window.addEventListener('omniterm:close-tab', listener)
        const { handler } = build('cc-set-none', { hasSelection: () => false })
        handler(ctrlC())
        expect(handler(ctrlC())).toBe(true)
        window.removeEventListener('omniterm:close-tab', listener)
        expect(listener).not.toHaveBeenCalled()
      })

      it('does not hint when the hint is switched off', () => {
        setCtrlCSettings({ showHint: false })
        const onInterruptHint = vi.fn()
        const { handler } = build('cc-set-hint', { hasSelection: () => false }, { onInterruptHint })
        handler(ctrlC())
        expect(onInterruptHint).not.toHaveBeenCalled()
      })
    })
  })
})
