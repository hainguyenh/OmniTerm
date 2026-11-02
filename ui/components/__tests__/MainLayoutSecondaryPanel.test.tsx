/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MainLayoutSecondaryPanel from '../MainLayoutSecondaryPanel'
import type { MainLayoutModel } from '../useMainLayoutController'

vi.mock('../WorkspacePanel', () => ({
  default: () => <div data-testid="mock-workspace-panel">Workspace Panel</div>,
}))
vi.mock('../BookmarksPanel', () => ({
  default: () => <div data-testid="mock-bookmarks-panel">Bookmarks Panel</div>,
}))
vi.mock('../FileBrowser', () => ({
  default: () => <div data-testid="mock-file-browser">File Browser</div>,
}))

function createMockModel(overrides: Partial<MainLayoutModel> = {}): MainLayoutModel {
  return {
    activeView: 'workspace',
    sidebarVisible: true,
    sidebarWidth: 260,
    openEditor: vi.fn(),
    scriptRuns: { run: vi.fn() },
    showAlert: vi.fn(),
    handleConnect: vi.fn(),
    hasConnectionProvider: false,
    setConnFormInitial: vi.fn(),
    openConnectionForm: vi.fn(),
    wsConnectionsRevision: 0,
    revealRequest: null,
    activeTabId: null,
    editorTabs: {},
    requestNewSession: vi.fn(),
    showTab: vi.fn(),
    activeSshId: null,
    activeSshName: null,
    refreshWorkspaces: vi.fn(),
    ...overrides,
  } as unknown as MainLayoutModel
}

describe('MainLayoutSecondaryPanel', () => {
  it('renders workspace panel when activeView is workspace', () => {
    const model = createMockModel({ activeView: 'workspace' })
    render(<MainLayoutSecondaryPanel model={model} />)
    expect(screen.getByTestId('mock-workspace-panel')).toBeInTheDocument()
  })

  it('renders bookmarks panel when activeView is bookmarks', () => {
    const model = createMockModel({ activeView: 'bookmarks' })
    render(<MainLayoutSecondaryPanel model={model} />)
    expect(screen.getByTestId('mock-bookmarks-panel')).toBeInTheDocument()
  })

  it('renders file browser when activeView is files and SSH session is active', () => {
    const model = createMockModel({ activeView: 'files', activeSshId: 'ssh-1', activeSshName: 'My Server' })
    render(<MainLayoutSecondaryPanel model={model} />)
    expect(screen.getByTestId('mock-file-browser')).toBeInTheDocument()
  })
})
