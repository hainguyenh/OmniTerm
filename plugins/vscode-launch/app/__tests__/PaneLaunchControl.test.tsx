/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getLaunchState,
  registerLaunchApi,
  resetLaunchStore,
  setLaunchAvailable,
  setRunsSnapshot,
} from '../launchStore'
import { PaneLaunchControl } from '../PaneLaunchControl'
import type { VsCodeLaunchAPI } from '../vscodeLaunchAPI'

function createMockApi(overrides: Partial<VsCodeLaunchAPI> = {}): VsCodeLaunchAPI {
  return {
    info: async () => ({ available: true, editors: ['codium'] }),
    discover: async (rootDir) => ({
      rootDir,
      editors: ['codium'],
      compounds: [
        {
          id: '.::compound::Full Stack',
          name: 'Full Stack',
          relativeFolder: '.',
          workspaceFolder: rootDir,
          configIds: ['.::Gateway', 'apps/auth::Auth API'],
          missingTargets: [],
          stopAll: true,
        },
      ],
      files: [
        {
          launchJsonPath: `${rootDir}/.vscode/launch.json`,
          workspaceFolder: rootDir,
          relativeFolder: '.',
          version: '0.2.0',
          configurations: [
            {
              id: '.::Gateway',
              name: 'Gateway',
              type: 'node',
              request: 'launch',
              runnable: true,
              workspaceFolder: rootDir,
              relativeFolder: '.',
            },
          ],
        },
        {
          launchJsonPath: `${rootDir}/apps/auth/.vscode/launch.json`,
          workspaceFolder: `${rootDir}/apps/auth`,
          relativeFolder: 'apps/auth',
          version: '0.2.0',
          configurations: [
            {
              id: 'apps/auth::Auth API',
              name: 'Auth API',
              type: 'netcoredbg',
              request: 'launch',
              runnable: true,
              workspaceFolder: `${rootDir}/apps/auth`,
              relativeFolder: 'apps/auth',
            },
          ],
        },
        {
          launchJsonPath: `${rootDir}/services/legacy/.vscode/launch.json`,
          workspaceFolder: `${rootDir}/services/legacy`,
          relativeFolder: 'services/legacy',
          version: '0.1.0',
          configurations: [],
          error: 'Unsupported launch.json version "0.1.0" (requires >= 0.2.0)',
        },
      ],
    }),
    start: vi.fn<VsCodeLaunchAPI['start']>(async ({ rootDir, configIds, compoundId, mode }) => [
      {
        runId: 'run-new',
        configId: configIds?.[0] ?? compoundId ?? '.::Gateway',
        name: 'Gateway',
        type: 'node',
        mode,
        status: 'running',
        rootDir,
        workspaceFolder: rootDir,
        relativeFolder: '.',
        cwd: rootDir,
        terminalCommand: 'node index.js',
        startedAt: 200,
        listeningUrls: [],
      },
    ]),
    stop: vi.fn<VsCodeLaunchAPI['stop']>(async () => []),
    stopInRoot: vi.fn<VsCodeLaunchAPI['stopInRoot']>(async () => []),
    removeRun: vi.fn<VsCodeLaunchAPI['removeRun']>(async () => true),
    restart: vi.fn<VsCodeLaunchAPI['restart']>(async () => null),
    listRuns: vi.fn<VsCodeLaunchAPI['listRuns']>(async () => []),
    readLogs: vi.fn<VsCodeLaunchAPI['readLogs']>(async (runId, afterSeq) => ({
      runId,
      lines: [],
      nextSeq: afterSeq,
      truncated: false,
    })),
    sendInput: vi.fn<VsCodeLaunchAPI['sendInput']>(async () => true),
    openInEditor: vi.fn<VsCodeLaunchAPI['openInEditor']>(async () => ({ ok: true, editor: 'codium' })),
    openUrl: vi.fn<VsCodeLaunchAPI['openUrl']>(async () => true),
    ...overrides,
  }
}

describe('PaneLaunchControl', () => {
  beforeEach(() => {
    resetLaunchStore()
  })

  it('renders nothing when plugin is unavailable or folder has no launch configurations', async () => {
    const emptyApi = createMockApi({
      discover: async (rootDir) => ({ rootDir, files: [], compounds: [], editors: [] }),
    })
    registerLaunchApi(emptyApi)

    const { rerender, container } = render(<PaneLaunchControl folderPath="/empty-repo" />)
    expect(container.firstChild).toBeNull()

    await act(async () => {
      setLaunchAvailable(true, ['codium'])
      rerender(<PaneLaunchControl folderPath="/empty-repo" />)
    })
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders pill, opens portal dropdown, launches single, multi-selected, and compound runs in Run and Debug modes', async () => {
    const api = createMockApi()
    registerLaunchApi(api)
    setLaunchAvailable(true, ['codium'])

    render(<PaneLaunchControl folderPath="/monorepo" />)

    const trigger = await screen.findByTestId('pane-launch-trigger')
    expect(trigger).toHaveTextContent(/Launch/i)

    fireEvent.click(trigger)
    expect(await screen.findByTestId('pane-launch-popover')).toBeInTheDocument()
    expect(screen.getByText('Full Stack')).toBeInTheDocument()
    expect(screen.getByText('Gateway')).toBeInTheDocument()
    expect(screen.getByText('Auth API')).toBeInTheDocument()
    expect(screen.getByText(/services\/legacy/i)).toBeInTheDocument()

    // Trigger single Debug run on Auth API
    fireEvent.click(screen.getByLabelText('Debug Auth API'))
    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith({
        rootDir: '/monorepo',
        configIds: ['apps/auth::Auth API'],
        mode: 'debug',
      }),
    )

    // Multi-select both configs and launch simultaneously in Run Without Debugging
    // Verify clicking the launch name label directly toggles the switch zone
    fireEvent.click(screen.getByText('Gateway'))
    fireEvent.click(screen.getByLabelText('Select Auth API'))
    fireEvent.click(screen.getByTestId('launch-selected-button'))
    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith({
        rootDir: '/monorepo',
        configIds: ['.::Gateway', 'apps/auth::Auth API'],
        mode: 'run',
      }),
    )

    // Launch compound
    fireEvent.click(screen.getByLabelText('Run compound Full Stack'))
    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith({
        rootDir: '/monorepo',
        compoundId: '.::compound::Full Stack',
        mode: 'run',
      }),
    )

    // Escape closes popover
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('pane-launch-popover')).not.toBeInTheDocument())
  })

  it('shows active running/debug counts on the pill and opens Console Drawer on demand', async () => {
    const api = createMockApi()
    registerLaunchApi(api)
    setLaunchAvailable(true, ['codium'])
    setRunsSnapshot([
      {
        runId: 'dbg-1',
        configId: 'apps/auth::Auth API',
        name: 'Auth API',
        type: 'netcoredbg',
        mode: 'debug',
        status: 'running',
        rootDir: '/monorepo',
        workspaceFolder: '/monorepo/apps/auth',
        relativeFolder: 'apps/auth',
        cwd: '/monorepo/apps/auth',
        terminalCommand: 'netcoredbg --server=4711 -- dotnet Auth.dll',
        pid: 3021,
        startedAt: 500,
        listeningUrls: ['http://localhost:5001'],
        attach: { kind: 'netcoredbg-server', host: '127.0.0.1', port: 4711, pid: 3021 },
      },
    ])

    render(<PaneLaunchControl folderPath="/monorepo" />)

    const trigger = await screen.findByTestId('pane-launch-trigger')
    expect(trigger).toHaveTextContent('1 debug')

    fireEvent.click(trigger)
    const consoleBtn = await screen.findByLabelText('Open terminal output for Auth API')
    fireEvent.click(consoleBtn)

    expect(getLaunchState().consoleOpen).toBe(true)
    expect(getLaunchState().activeRunId).toBe('dbg-1')
  })

  it('supports live-row Copy Attach, Open in VSCodium, Restart, Stop, Stop All, Rescan, mode toggle, and search filter', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    })

    const manyConfigs = Array.from({ length: 6 }, (_, idx) => ({
      id: `.::Svc-${idx + 1}`,
      name: `Svc-${idx + 1}`,
      type: 'coreclr',
      request: 'launch',
      runnable: true,
      workspaceFolder: '/monorepo',
      relativeFolder: '.',
    }))

    const api = createMockApi({
      discover: vi.fn<VsCodeLaunchAPI['discover']>(async (rootDir) => ({
        rootDir,
        editors: ['codium'],
        compounds: [
          {
            id: '.::compound::Pair',
            name: 'Pair',
            relativeFolder: '.',
            workspaceFolder: rootDir,
            configIds: ['.::Svc-1', '.::Svc-2'],
            missingTargets: [],
            stopAll: true,
          },
        ],
        files: [
          {
            launchJsonPath: `${rootDir}/.vscode/launch.json`,
            workspaceFolder: rootDir,
            relativeFolder: '.',
            version: '0.2.0',
            configurations: manyConfigs,
          },
        ],
      })),
    })
    registerLaunchApi(api)
    setLaunchAvailable(true, ['codium'])
    setRunsSnapshot([
      {
        runId: 'live-1',
        configId: '.::Svc-1',
        name: 'Svc-1',
        type: 'coreclr',
        mode: 'debug',
        status: 'running',
        rootDir: '/monorepo',
        workspaceFolder: '/monorepo',
        relativeFolder: '.',
        cwd: '/monorepo',
        terminalCommand: 'netcoredbg --server=4711 -- dotnet Svc1.dll',
        pid: 5120,
        startedAt: 900,
        listeningUrls: ['http://localhost:5010'],
        attach: {
          kind: 'netcoredbg-server',
          host: '127.0.0.1',
          port: 4711,
          pid: 5120,
          attachJson: '{"debugServer":4711}',
        },
      },
      {
        runId: 'past-2',
        configId: '.::Svc-2',
        name: 'Svc-2',
        type: 'coreclr',
        mode: 'run',
        status: 'exited',
        exitCode: 0,
        rootDir: '/monorepo',
        workspaceFolder: '/monorepo',
        relativeFolder: '.',
        cwd: '/monorepo',
        terminalCommand: 'dotnet Svc2.dll',
        startedAt: 800,
        listeningUrls: [],
      },
    ])

    render(<PaneLaunchControl folderPath="/monorepo" />)

    const trigger = await screen.findByTestId('pane-launch-trigger')
    fireEvent.click(trigger)
    expect(await screen.findByTestId('pane-launch-popover')).toBeInTheDocument()

    // Search input appears when > 5 configs
    const filter = screen.getByPlaceholderText(/Filter launches/i)
    fireEvent.change(filter, { target: { value: 'Svc-1' } })
    expect(screen.getByText('Svc-1')).toBeInTheDocument()
    expect(screen.queryByText('Svc-6')).not.toBeInTheDocument()
    fireEvent.change(filter, { target: { value: '' } })

    // Live-row debug actions: Copy Attach, Open in VSCodium, Restart, Stop
    fireEvent.click(screen.getByLabelText('Copy debug attach config for Svc-1'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{"debugServer":4711}')

    fireEvent.click(screen.getByLabelText('Open Svc-1 in VSCodium'))
    await waitFor(() => expect(api.openInEditor).toHaveBeenCalledWith('/monorepo', 'codium'))

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(screen.getByLabelText('Open http://localhost:5010 in browser'))
    expect(openSpy).toHaveBeenCalledWith('http://localhost:5010', '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()

    fireEvent.click(screen.getByLabelText('Restart Svc-1'))
    await waitFor(() => expect(api.restart).toHaveBeenCalledWith('live-1', undefined))

    // Re-seed live run to test Stop + Stop All + mode toggle + compound Debug + previous output button
    act(() => {
      setRunsSnapshot([
        {
          runId: 'live-1',
          configId: '.::Svc-1',
          name: 'Svc-1',
          type: 'coreclr',
          mode: 'run',
          status: 'running',
          rootDir: '/monorepo',
          workspaceFolder: '/monorepo',
          relativeFolder: '.',
          cwd: '/monorepo',
          terminalCommand: 'dotnet Svc1.dll',
          startedAt: 960,
          listeningUrls: ['http://localhost:5010'],
        },
        {
          runId: 'live-3',
          configId: '.::Svc-3',
          name: 'Svc-3',
          type: 'coreclr',
          mode: 'run',
          status: 'running',
          rootDir: '/monorepo',
          workspaceFolder: '/monorepo',
          relativeFolder: '.',
          cwd: '/monorepo',
          terminalCommand: 'dotnet Svc3.dll',
          startedAt: 950,
          listeningUrls: ['http://localhost:8080'],
        },
        {
          runId: 'past-2',
          configId: '.::Svc-2',
          name: 'Svc-2',
          type: 'coreclr',
          mode: 'run',
          status: 'failed',
          rootDir: '/monorepo',
          workspaceFolder: '/monorepo',
          relativeFolder: '.',
          cwd: '/monorepo',
          terminalCommand: 'dotnet Svc2.dll',
          startedAt: 800,
          listeningUrls: [],
        },
      ])
    })

    fireEvent.click(screen.getByLabelText('Open terminal output for Svc-2'))
    expect(getLaunchState().consoleOpen).toBe(true)

    // Re-open popover after opening Svc-2 output closed it
    fireEvent.click(trigger)
    expect(await screen.findByTestId('pane-launch-popover')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Stop Svc-1'))
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith(['live-1']))

    act(() => {
      setRunsSnapshot([
        {
          runId: 'live-3',
          configId: '.::Svc-3',
          name: 'Svc-3',
          type: 'coreclr',
          mode: 'run',
          status: 'running',
          rootDir: '/monorepo',
          workspaceFolder: '/monorepo',
          relativeFolder: '.',
          cwd: '/monorepo',
          terminalCommand: 'dotnet Svc3.dll',
          startedAt: 950,
          listeningUrls: ['http://localhost:8080'],
        },
      ])
    })

    fireEvent.click(screen.getByText('Debug'))
    expect(getLaunchState().defaultMode).toBe('debug')
    fireEvent.click(screen.getByText('Run'))
    expect(getLaunchState().defaultMode).toBe('run')

    fireEvent.click(screen.getByLabelText('Debug compound Pair'))
    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith({
        rootDir: '/monorepo',
        compoundId: '.::compound::Pair',
        mode: 'debug',
      }),
    )

    fireEvent.click(screen.getByLabelText('Run Svc-4 without debugging'))
    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith({
        rootDir: '/monorepo',
        configIds: ['.::Svc-4'],
        mode: 'run',
      }),
    )

    fireEvent.click(screen.getByLabelText('Rescan launch.json files'))
    await waitFor(() => expect(api.discover).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByText('Stop All'))
    await waitFor(() => expect(api.stopInRoot).toHaveBeenCalledWith('/monorepo'))

    // Outside click closes popover
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByTestId('pane-launch-popover')).not.toBeInTheDocument())
  })

  it('renders menu item and opens popover on click when menuItem prop is true', async () => {
    const api = createMockApi()
    registerLaunchApi(api)
    setLaunchAvailable(true, ['codium'])

    render(<PaneLaunchControl folderPath="/monorepo" menuItem />)

    const menuItem = await screen.findByTestId('pane-launch-menu-item')
    expect(menuItem).toHaveAttribute('role', 'menuitem')
    expect(menuItem).toHaveTextContent('Launch (2)')
    expect(screen.queryByTestId('pane-launch-trigger')).not.toBeInTheDocument()

    fireEvent.click(menuItem)
    expect(await screen.findByTestId('pane-launch-popover')).toBeInTheDocument()
  })
})
