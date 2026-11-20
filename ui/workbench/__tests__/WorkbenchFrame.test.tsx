/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const activate = vi.hoisted(() => vi.fn())
const reconcilerStop = vi.hoisted(() => vi.fn())
const startReconciler = vi.hoisted(() => vi.fn(() => reconcilerStop))

const steps = vi.hoisted(() => ({ eager: [['eager', () => {}]], deferred: [['later', async () => () => {}]] }))

vi.mock('../activateWorkbenchFeatures', () => ({
  activateWorkbenchFeatures: activate,
  WORKBENCH_STEPS: steps.eager,
  DEFERRED_WORKBENCH_STEPS: steps.deferred,
}))
vi.mock('../sessions/sessionTabsReconciler', () => ({ startSessionTabsReconciler: startReconciler }))
vi.mock('../sessions/SessionCloseConfirmHost', () => ({ SessionCloseConfirmHost: () => <div data-testid="close-confirm-host" /> }))
vi.mock('../../ide/workbench/TitleBar', () => ({ TitleBar: () => <div data-testid="title-bar" /> }))
vi.mock('../../ide/workbench/StatusBar', () => ({ StatusBar: () => <div data-testid="status-bar" /> }))
vi.mock('../../ide/workbench/OverlayHost', () => ({ OverlayHost: () => null }))
vi.mock('../../ide/workbench/EditorArea', () => ({ EditorArea: () => <div data-testid="editor-area" /> }))
vi.mock('../../ide/workbench/toolwindows/ToolWindows', () => ({
  ToolWindowLayout: ({ editor }: { editor: ReactNode }) => <div data-testid="tool-windows">{editor}</div>,
}))

import { WorkbenchFrame } from '../WorkbenchFrame'

const shell = <div data-testid="shell">shell</div>

describe('WorkbenchFrame', () => {
  beforeEach(() => {
    activate.mockReset()
    activate.mockReturnValue(() => {})
    reconcilerStop.mockReset()
    startReconciler.mockClear()
  })

  it('shows the workbench shell once the features are active', () => {
    render(<WorkbenchFrame>{shell}</WorkbenchFrame>)
    expect(activate).toHaveBeenCalledTimes(1)
    // The window loads the deferred features too, after the shell has painted.
    expect(activate).toHaveBeenCalledWith(steps.eager, steps.deferred)
    expect(screen.getByTestId('tool-windows')).toBeTruthy()
    expect(screen.getByTestId('status-bar')).toBeTruthy()
    expect(screen.getByTestId('title-bar')).toBeTruthy()
    expect(screen.getByTestId('close-confirm-host')).toBeTruthy()
  })

  it('holds only dialogs in a zero-size slot, never inside the editor area (sessions are editor tabs)', () => {
    render(<WorkbenchFrame>{shell}</WorkbenchFrame>)
    const slot = document.querySelector('[data-dialogs-slot]')!
    expect(slot.contains(screen.getByTestId('shell'))).toBe(true)
    expect(screen.getByTestId('editor-area').contains(screen.getByTestId('shell'))).toBe(false)
  })

  it('keeps the session tabs and the sessions in step while mounted, and stops after', () => {
    const { unmount } = render(<WorkbenchFrame>{shell}</WorkbenchFrame>)
    expect(startReconciler).toHaveBeenCalledTimes(1)
    unmount()
    expect(reconcilerStop).toHaveBeenCalledTimes(1)
  })

  it('releases the features when it unmounts', () => {
    const release = vi.fn()
    activate.mockReturnValue(release)
    const { unmount } = render(<WorkbenchFrame>{shell}</WorkbenchFrame>)
    unmount()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
