/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerAction } from '../../ide/platform/actions'
import { setContext } from '../../ide/platform/context'
import { installKeyboardDispatcher, useKeymap } from '../../ide/platform/keymap'
import { claimsTerminalEscape, installTerminalEscapeClaim } from '../terminalDock/terminalEscapeClaim'

const terminal = vi.hoisted(() => ({ escapeToEditor: false }))
vi.mock('../../ide/platform/workflowSettings', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  workflowSettings: () => ({ terminal }),
}))

const focusEditor = vi.fn()
const disposers: Array<() => void> = []

/** A docked session terminal: the session host inside the Terminal tool window, xterm's input inside it. */
function dockedTerminalInput(): HTMLTextAreaElement {
  const toolWindow = document.createElement('section')
  toolWindow.dataset.toolwindow = 'omniterm.terminal'
  const host = document.createElement('div')
  host.dataset.sessionHost = 's1'
  const xterm = document.createElement('div')
  xterm.className = 'xterm'
  const input = document.createElement('textarea')
  xterm.appendChild(input)
  host.appendChild(xterm)
  toolWindow.appendChild(host)
  document.body.appendChild(toolWindow)
  return input
}

function pressEscape(target: Element): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  focusEditor.mockClear()
  useKeymap.setState({ overrides: { 'toolwindow.focusEditor': ['Escape'] } })
  setContext('toolWindowFocus', true)
  disposers.push(
    registerAction({ id: 'toolwindow.focusEditor', title: 'Focus Editor', category: 'Window', when: 'toolWindowFocus', run: focusEditor }),
    installKeyboardDispatcher(window),
  )
})

afterEach(() => {
  disposers.splice(0).reverse().forEach((dispose) => dispose())
  setContext('toolWindowFocus', false)
  useKeymap.setState({ overrides: {} })
  terminal.escapeToEditor = false
  document.body.innerHTML = ''
})

describe('Escape in a docked session terminal', () => {
  it('runs Focus Editor when nothing claims it (the bug)', async () => {
    pressEscape(dockedTerminalInput())
    await Promise.resolve()
    expect(focusEditor).toHaveBeenCalledTimes(1)
  })

  // Regression: Esc in the bottom Terminal tool window moved focus to the editor instead of reaching
  // the PTY, so an agent CLI (Claude Code, Codex) running there could not be interrupted.
  it('is left to the terminal so it reaches the PTY', async () => {
    disposers.push(installTerminalEscapeClaim())
    const event = pressEscape(dockedTerminalInput())
    await Promise.resolve()
    expect(focusEditor).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('still moves focus to the editor when the terminal setting asks for it', async () => {
    terminal.escapeToEditor = true
    disposers.push(installTerminalEscapeClaim())
    pressEscape(dockedTerminalInput())
    await Promise.resolve()
    expect(focusEditor).toHaveBeenCalledTimes(1)
  })
})

describe('claimsTerminalEscape', () => {
  it('only claims a plain Escape inside a session terminal', () => {
    const input = dockedTerminalInput()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    expect(claimsTerminalEscape({ target: input }, 'Escape')).toBe(true)
    expect(claimsTerminalEscape({ target: input }, 'Shift+Escape')).toBe(false)
    expect(claimsTerminalEscape({ target: outside }, 'Escape')).toBe(false)
    expect(claimsTerminalEscape({ target: null }, 'Escape')).toBe(false)
  })
})
