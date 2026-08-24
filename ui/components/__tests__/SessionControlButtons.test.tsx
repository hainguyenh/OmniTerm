/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@omniterm/contract'
import { mockOmnitermAPI } from '../../testUtils'
import { TOKYO_NIGHT } from '../../themes'
import SessionControlButtons from '../SessionControlButtons'
import { controlsOverflow } from '../sessionControlOverflow'

const local: Connection = {
  id: 'local', name: 'Local', type: 'LOCAL', host: '', port: '', user: '',
}
const ssh: Connection = {
  id: 'ssh', name: 'SSH', type: 'SSH', host: 'host', port: '22', user: 'me',
}
const rdp: Connection = {
  id: 'rdp', name: 'RDP', type: 'RDP', host: 'desk', port: '3389', user: 'me',
}

beforeEach(() => {
  localStorage.clear()
  mockOmnitermAPI({
    connect: {
      localInput: vi.fn(),
      sshInput: vi.fn(),
      setPersistencePolicy: vi.fn().mockResolvedValue(undefined),
    },
  })
})

describe('SessionControlButtons', () => {
  it('collapses only when required controls exceed available width', () => {
    expect(controlsOverflow(79, 80)).toBe(false)
    expect(controlsOverflow(80, 80)).toBe(false)
    expect(controlsOverflow(79, 81)).toBe(true)
  })

  it('shows the overflow menu when the rendered control group is constrained', () => {
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 80 })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this instanceof HTMLElement && this.classList.contains('terminal-control-measurement') ? 100 : 80
      },
    })
    try {
      render(
        <SessionControlButtons
          conn={local}
          sessionId="s1"
          busy
          detach="detach"
          onToggleDetach={vi.fn()}
          onToggleFullscreen={vi.fn()}
          appearance={{
            themes: [TOKYO_NIGHT],
            themeId: TOKYO_NIGHT.id,
            fontSize: 16,
            darkMode: true,
            onThemeApply: vi.fn(),
            onFontSizeChange: vi.fn(),
            scopeLabel: 'Pane 2',
            buttonTitle: 'Appearance — theme & font size (Pane 2)',
          }}
        />,
      )
      expect(screen.getByRole('button', { name: 'More terminal actions' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Clear terminal' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'More terminal actions' }))
      expect(screen.getByText('Theme')).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Theme' })).toBeInTheDocument()
    } finally {
      if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
    }
  })

  it('opens Theme and Session persistence from their full overflow rows', () => {
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 80 })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this instanceof HTMLElement && this.classList.contains('terminal-control-measurement') ? 100 : 80
      },
    })
    try {
      render(
        <SessionControlButtons
          conn={local}
          sessionId="s1"
          busy
          detach={null}
          onToggleDetach={vi.fn()}
          appearance={{
            themes: [TOKYO_NIGHT],
            themeId: TOKYO_NIGHT.id,
            fontSize: 16,
            darkMode: true,
            onThemeApply: vi.fn(),
            onFontSizeChange: vi.fn(),
          }}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'More terminal actions' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }))
      expect(screen.getByRole('button', { name: TOKYO_NIGHT.name })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('menuitem', { name: 'Session persistence' }))
      expect(screen.getByRole('menu', { name: 'Session persistence' })).toBeInTheDocument()
    } finally {
      if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
    }
  })

  it('restores controls when its allocated header slot grows', () => {
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    let slotWidth = 80
    let rootWidth = 80
    const observations: Array<{ target: Element; callback: ResizeObserverCallback }> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { this.callback = callback }
      private callback: ResizeObserverCallback
      observe(target: Element) { observations.push({ target, callback: this.callback }) }
      disconnect = vi.fn()
      unobserve = vi.fn()
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        if (this.getAttribute('data-testid') === 'control-slot') return slotWidth
        if (this.hasAttribute('data-session-control-root')) return rootWidth
        return 80
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this instanceof HTMLElement && this.classList.contains('terminal-control-measurement') ? 100 : 80
      },
    })
    try {
      render(
        <div data-testid="control-slot">
          <SessionControlButtons
            conn={local}
            sessionId="s1"
            busy
            detach="detach"
            onToggleDetach={vi.fn()}
            onToggleFullscreen={vi.fn()}
          />
        </div>,
      )
      expect(screen.getByRole('button', { name: 'More terminal actions' })).toBeInTheDocument()

      slotWidth = 160
      rootWidth = 160
      const slot = screen.getByTestId('control-slot')
      const root = screen.getByTestId('session-control-root')
      act(() => {
        observations.filter(({ target }) => target === slot || target === root).forEach(({ callback }) => callback([], {} as ResizeObserver))
      })

      expect(screen.queryByRole('button', { name: 'More terminal actions' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Clear terminal' })).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
      if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
    }
  })

  it('does not count sibling header controls as available action width', () => {
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        if (this.getAttribute('data-testid') === 'control-slot') return 160
        if (this.hasAttribute('data-session-control-root')) return 80
        return 80
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this instanceof HTMLElement && this.classList.contains('terminal-control-measurement') ? 100 : 80
      },
    })
    try {
      render(
        <div data-testid="control-slot">
          <SessionControlButtons
            conn={local}
            sessionId="s1"
            busy
            detach="detach"
            onToggleDetach={vi.fn()}
            onToggleFullscreen={vi.fn()}
          />
          <button type="button">Sibling header control</button>
        </div>,
      )

      expect(screen.getByRole('button', { name: 'More terminal actions' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Clear terminal' })).not.toBeInTheDocument()
    } finally {
      if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
    }
  })

  it('renders Stop, Clear, Persistence, Detach, and Fullscreen for a local session', () => {
    render(
      <SessionControlButtons
        conn={local}
        sessionId="s1"
        busy
        detach="detach"
        onToggleDetach={vi.fn()}
        fullscreen={false}
        onToggleFullscreen={vi.fn()}
        tooltipPlacement="top"
      />,
    )

    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear terminal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Session persistence' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detach into its own window' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus pane full screen' })).toBeInTheDocument()
  })

  it('routes Stop and Clear through the correct PTY channel', () => {
    const { rerender } = render(
      <SessionControlButtons
        conn={local}
        sessionId="s1"
        busy
        detach={null}
        onToggleDetach={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear terminal' }))
    expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('s1', '\x03')
    expect(window.omnitermAPI.connect.localInput).toHaveBeenCalledWith('s1', '\x0c')

    rerender(
      <SessionControlButtons
        conn={ssh}
        sessionId="s2"
        busy
        detach={null}
        onToggleDetach={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop current process' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear terminal' }))
    expect(window.omnitermAPI.connect.sshInput).toHaveBeenCalledWith('s2', '\x03')
    expect(window.omnitermAPI.connect.sshInput).toHaveBeenCalledWith('s2', '\x0c')
  })

  it('disables Stop while idle but leaves Clear available', () => {
    render(
      <SessionControlButtons
        conn={local}
        sessionId="s1"
        busy={false}
        detach={null}
        onToggleDetach={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Stop current process' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear terminal' })).toBeEnabled()
  })

  it('omits PTY-only controls for RDP but keeps detach/fullscreen', () => {
    render(
      <SessionControlButtons
        conn={rdp}
        sessionId="s3"
        busy={false}
        detach="detach"
        onToggleDetach={vi.fn()}
        fullscreen={false}
        onToggleFullscreen={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Stop current process' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear terminal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Session persistence' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detach into its own window' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus pane full screen' })).toBeInTheDocument()
  })

  it('shows the copy menu for terminal sessions but never for RDP', () => {
    const { unmount } = render(
      <SessionControlButtons conn={local} sessionId="s1" detach={null} onToggleDetach={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Copy terminal output' })).toBeInTheDocument()
    unmount()
    render(<SessionControlButtons conn={rdp} sessionId="s1" detach={null} onToggleDetach={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Copy terminal output' })).not.toBeInTheDocument()
  })
})
