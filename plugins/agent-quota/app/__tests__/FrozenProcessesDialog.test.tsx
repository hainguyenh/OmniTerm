/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FrozenProcessesDialog } from '../FrozenProcessesDialog'
import { registerQuotaCommands, resetQuotaStore, setReviewSession } from '../quotaStore'
import { seed, terminal } from './quotaFixtures'

const mockGetHeld = vi.fn()
const mockResumePid = vi.fn()
const mockTerminate = vi.fn()

vi.mock('../agentQuotaAPI', async () => {
  const actual = await vi.importActual('../agentQuotaAPI')
  return {
    ...actual,
    createAgentQuotaAPI: () => ({
      getHeld: mockGetHeld,
      resumePid: mockResumePid,
      terminate: mockTerminate,
    }),
  }
})

describe('FrozenProcessesDialog', () => {
  beforeEach(() => {
    resetQuotaStore()
    vi.clearAllMocks()
    mockGetHeld.mockResolvedValue([
      {
        pid: 101,
        startTime: 100,
        image: 'claude.exe',
        profileName: 'work',
        threads: [1001, 1002, 1003],
      },
      {
        pid: 202,
        startTime: 105,
        image: 'node.exe',
        profileName: 'work',
        threads: [2001],
      },
    ])
    mockResumePid.mockResolvedValue(true)
    mockTerminate.mockResolvedValue(1)
  })

  afterEach(() => {
    resetQuotaStore()
  })

  it('renders null when reviewSessionId is null', () => {
    seed()
    const { container } = render(<FrozenProcessesDialog />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the suspended processes list when reviewSessionId is active', async () => {
    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)

    expect(await screen.findByText('Suspended Processes')).toBeInTheDocument()
    expect(screen.getByText(/2 processes · 4 threads suspended/)).toBeInTheDocument()
    expect(screen.getByText('claude.exe')).toBeInTheDocument()
    expect(screen.getByText('node.exe')).toBeInTheDocument()
    expect(screen.getByText('PID 101')).toBeInTheDocument()
    expect(screen.getByText('PID 202')).toBeInTheDocument()
    expect(screen.getByText('3 threads suspended')).toBeInTheDocument()
  })

  it('expands and collapses thread IDs on click', async () => {
    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    await screen.findByText('claude.exe')

    const expandBtn = screen.getAllByLabelText('Expand threads')[0]
    fireEvent.click(expandBtn)

    expect(screen.getByText('TID 1001')).toBeInTheDocument()
    expect(screen.getByText('TID 1002')).toBeInTheDocument()
    expect(screen.getByText('TID 1003')).toBeInTheDocument()

    const collapseBtn = screen.getByLabelText('Collapse threads')
    fireEvent.click(collapseBtn)

    expect(screen.queryByText('TID 1001')).toBeNull()
  })

  it('calls resumePid when individual resume is clicked', async () => {
    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    await screen.findByText('claude.exe')

    const resumeBtns = screen.getAllByRole('button', { name: /Resume/i })
    // First resume button in process row
    fireEvent.click(resumeBtns[0])

    await waitFor(() => {
      expect(mockResumePid).toHaveBeenCalledWith('s1', 101)
    })
  })

  it('calls resumeAll when Resume All Processes is clicked', async () => {
    const resume = vi.fn()
    registerQuotaCommands({ resume })

    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    await screen.findByText('claude.exe')

    const resumeAllBtn = screen.getByRole('button', { name: /Resume All Processes/i })
    fireEvent.click(resumeAllBtn)

    expect(resume).toHaveBeenCalledWith('s1')
    expect(screen.queryByText('Suspended Processes')).toBeNull()
  })

  it('closes dialog on Escape key or close button', async () => {
    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    await screen.findByText('Suspended Processes')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Suspended Processes')).toBeNull()
  })

  it('closes dialog on backdrop click', async () => {
    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    const backdrop = await screen.findByTestId('aq-frozen-dialog-backdrop')
    fireEvent.mouseDown(backdrop)
    expect(screen.queryByText('Suspended Processes')).toBeNull()
  })

  it('closes dialog on close button click', async () => {
    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    await screen.findByText('Suspended Processes')
    const closeBtn = screen.getByLabelText('Close dialog')
    fireEvent.click(closeBtn)
    expect(screen.queryByText('Suspended Processes')).toBeNull()
  })

  it('calls terminate and removes process when Stop is clicked', async () => {
    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    await screen.findByText('claude.exe')

    const stopBtns = screen.getAllByRole('button', { name: /Stop/i })
    fireEvent.click(stopBtns[0])

    await waitFor(() => {
      expect(mockTerminate).toHaveBeenCalledWith('s1', 101, 100)
    })
    expect(screen.queryByText('PID 101')).toBeNull()
    expect(screen.getByText('PID 202')).toBeInTheDocument()
  })

  it('closes dialog when all remaining processes are terminated', async () => {
    mockGetHeld.mockResolvedValueOnce([
      {
        pid: 101,
        startTime: 100,
        image: 'claude.exe',
        profileName: 'work',
        threads: [],
      },
    ])
    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    await screen.findByText('claude.exe')

    const stopBtn = screen.getByRole('button', { name: /Stop/i })
    fireEvent.click(stopBtn)

    await waitFor(() => {
      expect(mockTerminate).toHaveBeenCalledWith('s1', 101, 100)
    })
    await waitFor(() => {
      expect(screen.queryByText('Suspended Processes')).toBeNull()
    })
  })

  it('closes dialog when all remaining processes are individually resumed', async () => {
    mockGetHeld.mockResolvedValueOnce([
      {
        pid: 101,
        startTime: 100,
        image: 'claude.exe',
        profileName: 'work',
        threads: [],
      },
    ])
    seed({ terminals: [terminal({ sessionId: 's1' })] })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    await screen.findByText('claude.exe')

    const resumeBtn = screen.getByTitle('Thaw this process')
    fireEvent.click(resumeBtn)

    await waitFor(() => {
      expect(mockResumePid).toHaveBeenCalledWith('s1', 101)
    })
    await waitFor(() => {
      expect(screen.queryByText('Suspended Processes')).toBeNull()
    })
  })

  it('falls back to terminal process when held processes return empty', async () => {
    mockGetHeld.mockResolvedValueOnce([])
    seed({
      terminals: [
        terminal({
          sessionId: 's1',
          agent: 'agy',
          pid: 999,
          startTime: 1234,
          profileName: 'dev',
        }),
      ],
    })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    expect(await screen.findByText('agy.exe')).toBeInTheDocument()
    expect(screen.getByText('PID 999')).toBeInTheDocument()
  })

  it('falls back to terminal process when getHeld rejects', async () => {
    mockGetHeld.mockRejectedValueOnce(new Error('fetch failed'))
    seed({
      terminals: [
        terminal({
          sessionId: 's1',
          agent: 'claude',
          pid: 888,
          startTime: 4321,
          profileName: 'default',
        }),
      ],
    })
    setReviewSession('s1')

    render(<FrozenProcessesDialog />)
    expect(await screen.findByText('claude.exe')).toBeInTheDocument()
    expect(screen.getByText('PID 888')).toBeInTheDocument()
  })
})
