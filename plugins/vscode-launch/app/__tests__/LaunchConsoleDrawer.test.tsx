/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getLaunchState,
  openConsoleForRun,
  resetLaunchStore,
  setRunsSnapshot,
} from '../launchStore'
import { describeAttachEndpoint } from '../attachFormat'
import type { VsCodeLaunchAPI } from '../vscodeLaunchAPI'
import { VsCodeLaunchRoot } from '../VsCodeLaunchRoot'

function createMockApi(overrides: Partial<VsCodeLaunchAPI> = {}): VsCodeLaunchAPI {
  return {
    info: vi.fn<VsCodeLaunchAPI['info']>(async () => ({ available: true, editors: ['codium'] })),
    discover: vi.fn<VsCodeLaunchAPI['discover']>(async (rootDir) => ({
      rootDir,
      files: [],
      compounds: [],
      editors: ['codium'],
    })),
    start: vi.fn<VsCodeLaunchAPI['start']>(async () => []),
    stop: vi.fn<VsCodeLaunchAPI['stop']>(async () => ['run-1']),
    stopInRoot: vi.fn<VsCodeLaunchAPI['stopInRoot']>(async () => []),
    removeRun: vi.fn<VsCodeLaunchAPI['removeRun']>(async () => true),
    restart: vi.fn<VsCodeLaunchAPI['restart']>(async () => null),
    listRuns: vi.fn<VsCodeLaunchAPI['listRuns']>(async () => []),
    readLogs: vi.fn<VsCodeLaunchAPI['readLogs']>(async (runId, afterSeq) => ({
      runId,
      lines:
        afterSeq === 0
          ? [
              { seq: 1, stream: 'stdout', text: '\u001b[32mNow listening on: http://localhost:5001\u001b[0m', timestamp: 100 },
              { seq: 2, stream: 'stderr', text: 'warn: cache miss', timestamp: 101 },
            ]
          : [],
      nextSeq: 2,
      truncated: true,
    })),
    sendInput: vi.fn<VsCodeLaunchAPI['sendInput']>(async () => true),
    openInEditor: vi.fn<VsCodeLaunchAPI['openInEditor']>(async () => ({ ok: true, editor: 'codium' })),
    openUrl: vi.fn<VsCodeLaunchAPI['openUrl']>(async () => true),
    ...overrides,
  }
}

describe('VsCodeLaunchRoot & LaunchConsoleDrawer', () => {
  beforeEach(() => {
    resetLaunchStore()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('probes plugin availability with backoff and hides drawer until opened', async () => {
    vi.useFakeTimers()
    const info = vi
      .fn<VsCodeLaunchAPI['info']>()
      .mockResolvedValueOnce({ available: false, editors: [] })
      .mockResolvedValue({ available: true, editors: ['codium'] })

    const api = createMockApi({ info })
    render(<VsCodeLaunchRoot api={api} onOpenInTerminal={vi.fn()} />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(getLaunchState().available).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(getLaunchState().available).toBe(true)
    expect(getLaunchState().editors).toEqual(['codium'])
    expect(screen.queryByTestId('launch-console-drawer')).not.toBeInTheDocument()
  })

  it('streams ANSI logs, filters lines, sends stdin, copies netcoredbg attach JSON, opens VSCodium, pops out terminal, resizes, and minimizes cleanly', async () => {
    const onOpenInTerminal = vi.fn()
    const api = createMockApi({
      listRuns: vi.fn<VsCodeLaunchAPI['listRuns']>(async () => [
        {
          runId: 'run-1',
          configId: 'apps/auth::Auth API',
          name: 'Auth API',
          type: 'netcoredbg',
          mode: 'debug',
          status: 'running',
          rootDir: '/monorepo',
          workspaceFolder: '/monorepo/apps/auth',
          relativeFolder: 'apps/auth',
          cwd: '/monorepo/apps/auth',
          terminalCommand: 'netcoredbg --interpreter=vscode --server=4711 -- dotnet Auth.dll',
          pid: 4100,
          startedAt: 1000,
          listeningUrls: ['http://localhost:5001'],
          attach: {
            kind: 'netcoredbg-server',
            host: '127.0.0.1',
            port: 4711,
            pid: 4100,
            attachJson: '{"name":"Attach netcoredbg (Auth API)","type":"coreclr","request":"attach","debugServer":4711}',
          },
        },
        {
          runId: 'run-2',
          configId: '.::Gateway',
          name: 'Gateway',
          type: 'node',
          mode: 'run',
          status: 'exited',
          exitCode: 0,
          rootDir: '/monorepo',
          workspaceFolder: '/monorepo',
          relativeFolder: '.',
          cwd: '/monorepo',
          terminalCommand: 'node gateway.js',
          startedAt: 900,
          listeningUrls: [],
        },
      ]),
    })

    render(<VsCodeLaunchRoot api={api} onOpenInTerminal={onOpenInTerminal} />)

    await waitFor(() => expect(getLaunchState().available).toBe(true))

    act(() => {
      setRunsSnapshot([
        {
          runId: 'run-1',
          configId: 'apps/auth::Auth API',
          name: 'Auth API',
          type: 'netcoredbg',
          mode: 'debug',
          status: 'running',
          rootDir: '/monorepo',
          workspaceFolder: '/monorepo/apps/auth',
          relativeFolder: 'apps/auth',
          cwd: '/monorepo/apps/auth',
          terminalCommand: 'netcoredbg --interpreter=vscode --server=4711 -- dotnet Auth.dll',
          pid: 4100,
          startedAt: 1000,
          listeningUrls: ['http://localhost:5001'],
          attach: {
            kind: 'netcoredbg-server',
            host: '127.0.0.1',
            port: 4711,
            pid: 4100,
            attachJson: '{"name":"Attach netcoredbg (Auth API)","type":"coreclr","request":"attach","debugServer":4711}',
          },
        },
        {
          runId: 'run-2',
          configId: '.::Gateway',
          name: 'Gateway',
          type: 'node',
          mode: 'run',
          status: 'exited',
          exitCode: 0,
          rootDir: '/monorepo',
          workspaceFolder: '/monorepo',
          relativeFolder: '.',
          cwd: '/monorepo',
          terminalCommand: 'node gateway.js',
          startedAt: 900,
          listeningUrls: [],
        },
      ])
      openConsoleForRun('run-1')
    })

    expect(await screen.findByTestId('launch-console-drawer')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'http://localhost:5001' })).toBeInTheDocument()
    expect(screen.getByText(/Now listening on:/)).toBeInTheDocument()
    expect(screen.getByText(/Earlier lines were trimmed/i)).toBeInTheDocument()

    // Filter log output (match + empty match)
    const filterInput = screen.getByPlaceholderText('Filter output...')
    fireEvent.change(filterInput, { target: { value: 'cache miss' } })
    expect(screen.queryByText(/Now listening on/)).not.toBeInTheDocument()
    expect(screen.getByText('warn: cache miss')).toBeInTheDocument()
    fireEvent.change(filterInput, { target: { value: 'zzzz-no-match' } })
    expect(screen.getByText(/No output lines match the current filter/i)).toBeInTheDocument()
    fireEvent.change(filterInput, { target: { value: '' } })

    // Send stdin on Enter
    const stdinInput = screen.getByPlaceholderText('Send input to stdin and press Enter...')
    fireEvent.change(stdinInput, { target: { value: 'reload' } })
    fireEvent.keyDown(stdinInput, { key: 'Enter' })
    await waitFor(() => expect(api.sendInput).toHaveBeenCalledWith('run-1', 'reload\n'))

    // Copy netcoredbg attach JSON + Copy Logs
    fireEvent.click(screen.getByLabelText('Copy attach configuration JSON'))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('"debugServer":4711'),
      ),
    )
    fireEvent.click(screen.getByLabelText('Copy displayed output'))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('Now listening on: http://localhost:5001'),
      ),
    )

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    // Open link directly
    const link = screen.getByRole('link', { name: 'http://localhost:5001' })
    fireEvent.click(link)
    expect(openSpy).toHaveBeenCalledWith('http://localhost:5001', '_blank', 'noopener,noreferrer')
    expect(api.openUrl).toHaveBeenCalledWith('http://localhost:5001')

    // Ctrl+click link surfaces TerminalLinkMenu
    fireEvent.click(link, { ctrlKey: true })
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('Copy Link')).toBeInTheDocument()
    expect(screen.getByText('Open Link')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Copy Link'))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:5001'),
    )

    // Open via header Globe button
    const globeBtn = screen.getByLabelText('Open http://localhost:5001 in browser')
    fireEvent.click(globeBtn)
    expect(openSpy).toHaveBeenCalledWith('http://localhost:5001', '_blank', 'noopener,noreferrer')

    openSpy.mockRestore()

    // Open in VSCodium
    fireEvent.click(screen.getByLabelText('Open folder in VSCodium'))
    await waitFor(() => expect(api.openInEditor).toHaveBeenCalledWith('/monorepo/apps/auth', 'codium'))

    // Right click on log viewport copies selected text to clipboard and suppresses native menu
    const panel = screen.getByRole('tabpanel')
    const getSelSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'selected console text',
    } as unknown as Selection)
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    panel.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('selected console text'),
    )
    expect(document.querySelector('[data-pixel-copied-toast="true"]')?.textContent).toBe('Copied')
    getSelSpy.mockRestore()

    // Pop out to real OmniTerm Terminal Tab
    fireEvent.click(screen.getByLabelText('Pop out to terminal tab'))
    expect(onOpenInTerminal).toHaveBeenCalledWith({
      name: 'Launch: Auth API',
      cwd: '/monorepo/apps/auth',
      terminalCommand: 'netcoredbg --interpreter=vscode --server=4711 -- dotnet Auth.dll',
    })

    // Drag resize handle updates consoleHeight
    const resizeHandle = screen.getByTestId('launch-console-resize-handle')
    fireEvent.mouseDown(resizeHandle, { clientY: 500 })
    fireEvent.mouseMove(window, { clientY: 420 })
    fireEvent.mouseUp(window)
    expect(getLaunchState().consoleHeight).toBe(360)

    // Header stop button stops running Auth API
    fireEvent.click(screen.getByLabelText('Stop Auth API'))
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith(['run-1']))

    // Switch tab to Gateway and clear output
    fireEvent.click(screen.getByRole('tab', { name: /Gateway/i }))
    expect(getLaunchState().activeRunId).toBe('run-2')
    fireEvent.click(screen.getByLabelText('Clear displayed output'))

    // Gateway is exited so its stop button is disabled
    expect(screen.getByLabelText('Stop Gateway')).toBeDisabled()

    // Tab wheel scroll
    const tablist = screen.getByRole('tablist')
    fireEvent.wheel(tablist, { deltaY: 40 })

    // Tab context menu on right click
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Gateway/i }), { clientX: 200, clientY: 100 })
    expect(await screen.findByRole('menu', { name: 'Gateway actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Stop Run/i })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Restart Run' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy Logs' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Clear Output' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Close Console' })).toBeInTheDocument()

    // Viewport font size and Ctrl+wheel resizing
    const viewport = screen.getByRole('tabpanel')
    expect(viewport).toHaveStyle({ fontSize: '14px' })
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: 50 })
    expect(viewport).toHaveStyle({ fontSize: '13px' })
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -50 })
    expect(viewport).toHaveStyle({ fontSize: '14px' })

    // Clicking Close Console from context menu closes target run permanently
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close Console' }))
    await waitFor(() => {
      expect(getLaunchState().runs.map((r) => r.runId)).toEqual(['run-1'])
    })
    expect(getLaunchState().activeRunId).toBe('run-1')

    // Header close button closes drawer
    fireEvent.click(screen.getByLabelText('Close launch console'))
    expect(getLaunchState().consoleOpen).toBe(false)
    expect(getLaunchState().consoleOpen).toBe(false)
  })

  it('formats all attach endpoint variants, uses omnitermAPI clipboard when present, and renders empty state + editor errors', async () => {
    expect(describeAttachEndpoint({ kind: 'netcoredbg-server', host: '127.0.0.1', port: 4711 })).toContain('4711')
    expect(describeAttachEndpoint({ kind: 'dotnet-pid', pid: 999 })).toContain('dotnet PID 999')
    expect(describeAttachEndpoint({ kind: 'node-inspector', wsUrl: 'ws://127.0.0.1:9229/id' })).toBe(
      'ws://127.0.0.1:9229/id',
    )
    expect(describeAttachEndpoint({ kind: 'debugpy', host: '127.0.0.1', port: 5678 })).toBe('127.0.0.1:5678')
    expect(describeAttachEndpoint({ kind: 'generic', pid: 42 })).toBe('PID 42')
    expect(describeAttachEndpoint({ kind: 'generic', note: 'Custom attach' })).toBe('Custom attach')

    const omniClip = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { omnitermAPI?: unknown }).omnitermAPI = {
      clipboard: { writeText: omniClip },
    }

    const errRun = {
      runId: 'run-err',
      configId: '.::Api',
      name: 'Api',
      type: 'node',
      mode: 'debug' as const,
      status: 'running' as const,
      rootDir: '/repo',
      workspaceFolder: '/repo',
      relativeFolder: '.',
      cwd: '/repo',
      terminalCommand: 'node api.js',
      startedAt: 100,
      listeningUrls: [],
      attach: {
        kind: 'node-inspector' as const,
        wsUrl: 'ws://127.0.0.1:9229/xyz',
      },
    }
    let currentRuns: typeof errRun[] = []
    const api = createMockApi({
      info: vi.fn<VsCodeLaunchAPI['info']>().mockResolvedValue({ available: true, editors: ['code'] }),
      listRuns: vi.fn<VsCodeLaunchAPI['listRuns']>(async () => currentRuns),
      openInEditor: vi
        .fn<VsCodeLaunchAPI['openInEditor']>()
        .mockResolvedValue({ ok: false, message: 'Code binary missing' }),
    })

    render(<VsCodeLaunchRoot api={api} onOpenInTerminal={vi.fn()} />)
    await waitFor(() => expect(getLaunchState().available).toBe(true))

    act(() => {
      openConsoleForRun()
    })
    expect(await screen.findByText('No launch runs yet')).toBeInTheDocument()

    currentRuns = [errRun]
    act(() => {
      setRunsSnapshot([errRun])
    })

    fireEvent.click(await screen.findByLabelText('Open folder in VS Code'))
    expect(await screen.findByText('Code binary missing')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Copy displayed output'))
    await waitFor(() => expect(omniClip).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText('Restart Api'))
    await waitFor(() => expect(api.restart).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('Stop Api'))
    await waitFor(() => expect(api.stop).toHaveBeenCalled())

    delete (window as unknown as { omnitermAPI?: unknown }).omnitermAPI
  })
})
