/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'
import SessionControlButtons from '../SessionControlButtons'

const local: Connection = { id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '' }

beforeEach(() => {
  mockOmnitermAPI({
    connect: {
      interruptSession: vi.fn().mockResolvedValue(undefined),
      localInput: vi.fn(),
      sshInput: vi.fn(),
    },
  })
})

it('moves trailing actions into More in order and restores the current-directory icon when wider', () => {
  let rootWidth = 62
  const originals = ['clientWidth', 'scrollWidth', 'offsetWidth'].map(key => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
  }))
  const observers: ResizeObserverCallback[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observers.push(callback) }
    observe = vi.fn()
    disconnect = vi.fn()
  })
  const widths: Record<string, number> = {
    currentDir: 20, stop: 16, clear: 16, copy: 16, detach: 16,
    theme: 16, font: 60, fullscreen: 16,
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return this.hasAttribute('data-session-control-root') ? rootWidth : 200 },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() { return this.classList.contains('terminal-control-measurement') ? 190 : 0 },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() { return widths[this.dataset.controlKey ?? ''] ?? 0 },
  })

  try {
    render(
      <SessionControlButtons
        conn={local} sessionId="s1" busy detach="detach" onToggleDetach={vi.fn()}
        onOpenCurrentDirectory={vi.fn()} onToggleFullscreen={vi.fn()} surface="header"
      />,
    )
    const root = screen.getByTestId('session-control-root')
    expect(root.querySelector('.terminal-control-measurement')).toHaveClass('w-max')
    expect(screen.getByRole('button', { name: 'Open new pane with current directory' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detach into its own window' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Focus pane full screen' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More terminal actions' }))
    expect(screen.getByRole('menuitem', { name: 'Focus pane full screen' })).toBeInTheDocument()

    rootWidth = 15
    act(() => observers.forEach(callback => callback([], {} as ResizeObserver)))
    expect(screen.queryByRole('button', { name: 'Open new pane with current directory' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More terminal actions' })).toBeInTheDocument()

    rootWidth = 230
    act(() => observers.forEach(callback => callback([], {} as ResizeObserver)))
    expect(screen.getByRole('button', { name: 'Open new pane with current directory' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus pane full screen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More terminal actions' })).not.toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
    for (const { key, descriptor } of originals) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
      else Reflect.deleteProperty(HTMLElement.prototype, key)
    }
  }
})
