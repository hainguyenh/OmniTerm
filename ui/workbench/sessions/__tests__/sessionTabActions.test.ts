/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ show: vi.fn(), openInput: vi.fn(() => Promise.resolve()) }))

vi.mock('../../../ide/workbench/contributions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toolWindowService: () => ({ show: mocks.show }),
  editorService: () => ({ openInput: mocks.openInput }),
}))

import { TERMINAL_WINDOW } from '../../terminalDock/terminalDockActions'
import { dockSession, resetTerminalDock, useTerminalDock } from '../../terminalDock/terminalDockStore'
import { showSessionTab } from '../sessionTabActions'

beforeEach(() => {
  resetTerminalDock()
  mocks.show.mockClear()
  mocks.openInput.mockClear()
})

describe('showSessionTab', () => {
  // Regression: picking a docked session in the Sessions list opened it as an editor tab instead of
  // showing it in the bottom Terminal tool window where it runs.
  it('selects a docked session in the Terminal tool window', () => {
    dockSession('a')
    dockSession('b')
    showSessionTab('a')
    expect(useTerminalDock.getState().active).toBe('a')
    expect(mocks.show).toHaveBeenCalledWith(TERMINAL_WINDOW)
    expect(mocks.openInput).not.toHaveBeenCalled()
  })

  it('opens an editor tab for a session that is not docked', () => {
    showSessionTab('c')
    expect(mocks.show).not.toHaveBeenCalled()
    expect(mocks.openInput).toHaveBeenCalledTimes(1)
  })
})
