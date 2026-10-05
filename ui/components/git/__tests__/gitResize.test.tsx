/** @vitest-environment jsdom */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitBranchPopup } from '../GitBranchPopup'
import { GitBranchQuickPopover } from '../GitBranchQuickPopover'
import { computePopoverStyle, opensUpward } from '../gitPopoverPlacement'
import { useResizablePanel } from '../useResizablePanel'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const MIN = { width: 200, height: 150 }

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

/** Renders the hook with a panel element whose measured size is 300×200. */
function renderPanel(growth: { x: 1 | 2; y: 1 | 2 | -1 }, storageKey = 'test:size') {
  const hook = renderHook(() => useResizablePanel<HTMLDivElement>({ storageKey, minSize: MIN, growth }))
  const panel = document.createElement('div')
  panel.getBoundingClientRect = () => ({ width: 300, height: 200 }) as DOMRect
  Object.assign(hook.result.current.panelRef, { current: panel })
  return hook
}

const mouse = (clientX: number, clientY: number, button = 0) =>
  ({ button, clientX, clientY, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as React.MouseEvent<HTMLElement>
const key = (name: string) =>
  ({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as React.KeyboardEvent<HTMLElement>

describe('useResizablePanel', () => {
  beforeEach(() => {
    localStorage.clear()
    setViewport(1000, 800)
  })

  it('grows with the grip, clamps to the viewport and minimum, and remembers the size', () => {
    const { result } = renderPanel({ x: 1, y: -1 })
    expect(result.current.size).toBeNull()

    act(() => result.current.startResize(mouse(100, 500)))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 160, clientY: 400 }))
    })
    expect(result.current.size).toEqual({ width: 360, height: 300 })
    expect(localStorage.getItem('test:size')).toBeNull()

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000, clientY: 5000 }))
    })
    expect(result.current.size).toEqual({ width: 984, height: 150 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(JSON.parse(localStorage.getItem('test:size') ?? 'null')).toEqual({ width: 984, height: 150 })

    // Released: further movement no longer resizes.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }))
    })
    expect(result.current.size).toEqual({ width: 984, height: 150 })
  })

  it('doubles the growth of a centered panel and ignores secondary buttons', () => {
    const { result } = renderPanel({ x: 2, y: 2 })
    act(() => result.current.startResize(mouse(0, 0, 2)))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50 }))
    })
    expect(result.current.size).toBeNull()

    act(() => result.current.startResize(mouse(0, 0)))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 25 }))
    })
    expect(result.current.size).toEqual({ width: 400, height: 250 })
  })

  it('resizes from the keyboard in the grip direction and resets with Home', () => {
    const { result } = renderPanel({ x: 1, y: -1 })
    act(() => result.current.resizeWithKeyboard(key('ArrowUp')))
    expect(result.current.size).toEqual({ width: 300, height: 216 })
    act(() => result.current.resizeWithKeyboard(key('ArrowRight')))
    act(() => result.current.resizeWithKeyboard(key('ArrowDown')))
    act(() => result.current.resizeWithKeyboard(key('ArrowLeft')))
    act(() => result.current.resizeWithKeyboard(key('ArrowLeft')))
    expect(result.current.size).toEqual({ width: 284, height: 200 })
    expect(JSON.parse(localStorage.getItem('test:size') ?? 'null')).toEqual({ width: 284, height: 200 })

    act(() => result.current.resizeWithKeyboard(key('Enter')))
    expect(result.current.size).toEqual({ width: 284, height: 200 })
    act(() => result.current.resizeWithKeyboard(key('Home')))
    expect(result.current.size).toBeNull()
    expect(localStorage.getItem('test:size')).toBeNull()
  })

  it('restores a stored size and rejects malformed ones', () => {
    localStorage.setItem('good', JSON.stringify({ width: 420, height: 310 }))
    expect(renderPanel({ x: 1, y: 1 }, 'good').result.current.size).toEqual({ width: 420, height: 310 })
    for (const stored of ['{', 'null', '{"width":"1","height":2}', '{"width":1e999,"height":2}']) {
      localStorage.setItem('bad', stored)
      expect(renderPanel({ x: 1, y: 1 }, 'bad').result.current.size).toBeNull()
    }
  })

  it('stops listening when the panel unmounts mid-drag', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { result, unmount } = renderPanel({ x: 1, y: 1 })
    act(() => result.current.startResize(mouse(0, 0)))
    unmount()
    expect(remove).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('mouseup', expect.any(Function))
    remove.mockRestore()
  })
})

describe('computePopoverStyle', () => {
  beforeEach(() => setViewport(1200, 800))

  it('keeps the default placement until the user picks a size', () => {
    expect(opensUpward(null)).toBe(true)
    expect(computePopoverStyle(null)).toMatchObject({ bottom: 36, left: 12, width: 340, maxHeight: 480 })
    expect(computePopoverStyle(null, { width: 500, height: 400 })).toMatchObject({ width: 500, height: 400, maxHeight: undefined })

    const footer = { top: 770, bottom: 790, left: 1100, right: 1150 }
    expect(computePopoverStyle(footer)).toMatchObject({ bottom: 34, left: 852, width: 340, maxHeight: 480 })
    expect(computePopoverStyle(footer, { width: 600, height: 900 })).toMatchObject({ left: 592, width: 600, height: 900, maxHeight: 758 })

    const toolbar = { top: 40, bottom: 76, left: 300, right: 400 }
    expect(opensUpward(toolbar)).toBe(false)
    expect(computePopoverStyle(toolbar)).toMatchObject({ top: 80, left: 300, maxHeight: 480 })
    expect(computePopoverStyle(toolbar, { width: 500, height: 600 })).toMatchObject({ top: 80, height: 600, maxHeight: 712 })
  })
})

describe('resizable branch panels', () => {
  beforeEach(() => {
    localStorage.clear()
    setViewport(1200, 800)
    invoke.mockReset()
    invoke.mockResolvedValue([])
  })

  it('puts the quick popover grip on the edge that grows and applies its remembered size', async () => {
    localStorage.setItem('omniterm:git-branch-popover-size:up', JSON.stringify({ width: 520, height: 360 }))
    const footer = { top: 770, bottom: 790, left: 20, right: 80 }
    const { unmount } = render(<GitBranchQuickPopover cwd="/repo" currentBranch="feature/a-very-long-branch-name" anchorRect={footer} onClose={vi.fn()} onExpand={vi.fn()} />)
    await act(async () => {})
    const popover = screen.getByTestId('branch-quick-popover')
    expect(popover).toHaveStyle({ width: '520px', height: '360px' })
    expect(screen.getByRole('separator', { name: 'Resize branch popover' })).toHaveClass('is-top-right')
    unmount()

    const toolbar = { top: 40, bottom: 76, left: 300, right: 400 }
    render(<GitBranchQuickPopover cwd="/repo" anchorRect={toolbar} onClose={vi.fn()} onExpand={vi.fn()} />)
    await act(async () => {})
    expect(screen.getByRole('separator', { name: 'Resize branch popover' })).toHaveClass('is-bottom-right')
    expect(screen.getByTestId('branch-quick-popover')).toHaveStyle({ width: '340px' })
  })

  it('resizes the branch manager dialog and resets it on double-click', async () => {
    localStorage.setItem('omniterm:git-branch-dialog-size', JSON.stringify({ width: 1000, height: 700 }))
    render(<GitBranchPopup cwd="/repo" currentBranch="main" onClose={vi.fn()} />)
    await act(async () => {})
    const dialog = screen.getByRole('dialog', { name: 'Git Branches' })
    expect(dialog).toHaveClass('is-resized')
    expect(dialog).toHaveStyle({ width: '1000px', height: '700px' })

    const grip = screen.getByRole('separator', { name: 'Resize branch manager' })
    fireEvent.mouseDown(grip, { button: 0, clientX: 500, clientY: 500 })
    fireEvent.mouseMove(window, { clientX: 450, clientY: 480 })
    fireEvent.mouseUp(window)
    expect(dialog).toHaveStyle({ width: '900px', height: '660px' })

    fireEvent.doubleClick(grip)
    expect(dialog).not.toHaveClass('is-resized')
    expect(localStorage.getItem('omniterm:git-branch-dialog-size')).toBeNull()
  })
})
