/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_QUOTA_CONFIG } from '../quotaConfig'
import { refreshPaceArt, resetPaceArtForTests } from '../headerLoadingArt'
import { LoadingArtSettings } from '../LoadingArtSettings'

describe('LoadingArtSettings', () => {
  beforeEach(() => {
    resetPaceArtForTests()
    vi.restoreAllMocks()
    window.omnitermAPI = {
      ...(window.omnitermAPI ?? {}),
      customArt: {
        get: vi.fn().mockResolvedValue(null),
        upload: vi.fn().mockResolvedValue('blob:uploaded-art'),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    } as any
  })

  it('renders switch only when customArtSession is disabled', async () => {
    const onChange = vi.fn()
    const refreshCustomArt = vi.fn()
    const display = { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: false }

    await act(async () => {
      render(<LoadingArtSettings display={display} onChange={onChange} refreshCustomArt={refreshCustomArt} />)
    })

    const toggle = screen.getByRole('switch', { name: 'Show agent loading artwork' })
    expect(toggle).not.toBeChecked()
    expect(screen.queryByLabelText('Custom agent session artwork')).toBeNull()

    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ customArtSession: true }))
  })

  it('renders motion options, preview panel, and handles speed/size changes', async () => {
    let resizeCb: (() => void) | undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resizeCb = cb
        }
        observe = vi.fn()
        disconnect = vi.fn()
      },
    )

    const onChange = vi.fn()
    const refreshCustomArt = vi.fn()
    const display = {
      ...DEFAULT_QUOTA_CONFIG.display,
      customArtSession: true,
      artSpeed: undefined,
      artSize: undefined,
    }

    await act(async () => {
      render(<LoadingArtSettings display={display} onChange={onChange} refreshCustomArt={refreshCustomArt} />)
    })

    expect(screen.getByLabelText('Custom agent session artwork')).toBeInTheDocument()
    expect(screen.getByLabelText('Loading artwork preview')).toBeInTheDocument()

    // Blazing critical preview
    const criticalPreview = screen.getByTestId('art-preview-overshooting')
    expect(criticalPreview).toHaveClass('aq-busy-art-blazing')
    expect(criticalPreview).toHaveAttribute('data-blazing', 'true')

    // Trigger distance factor on preview items
    vi.spyOn(criticalPreview, 'getBoundingClientRect').mockReturnValue({ width: 300 } as DOMRect)
    act(() => {
      resizeCb?.()
    })
    expect(criticalPreview.style.getPropertyValue('--aq-art-distance-factor')).toBeTruthy()

    // Change speed
    fireEvent.click(screen.getByRole('button', { name: 'Fast (1.6x)' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ artSpeed: 'fast' }))

    // Change size
    fireEvent.click(screen.getByRole('button', { name: 'large' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ artSize: 'large' }))

    // Switch preview mode
    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    const preview = screen.getByLabelText('Loading artwork preview')
    expect(preview).toHaveAttribute('data-art-mode', 'light')

    vi.unstubAllGlobals()
  })

  it('handles uploading custom art, in-progress state, and cancellation', async () => {
    let resolveUpload!: (url: string) => void
    const pendingUpload = new Promise<string>((res) => {
      resolveUpload = res
    })
    const uploadMock = vi.fn().mockImplementation(() => pendingUpload)
    window.omnitermAPI.customArt.upload = uploadMock
    const refreshCustomArt = vi.fn()
    const display = { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: true }

    await act(async () => {
      render(<LoadingArtSettings display={display} onChange={vi.fn()} refreshCustomArt={refreshCustomArt} />)
    })

    const uploadBtn = screen.getByRole('button', { name: 'Upload Slow light mode artwork' })
    fireEvent.click(uploadBtn)
    expect(uploadBtn).toHaveTextContent('…')

    await act(async () => {
      resolveUpload('blob:uploaded-art')
    })

    expect(uploadMock).toHaveBeenCalledWith('pace-slow-light')
    expect(refreshCustomArt).toHaveBeenCalled()
    expect(uploadBtn).toHaveTextContent('Upload')

    // Upload rejection (e.g. cancelled file dialog)
    uploadMock.mockRejectedValueOnce(new Error('User cancelled'))
    await act(async () => {
      fireEvent.click(uploadBtn)
    })
    // Doesn't throw and finishes
    expect(uploadBtn).toBeEnabled()
  })

  it('renders remove button when customUrl exists, and handles remove success and failure', async () => {
    window.omnitermAPI.customArt.get = vi.fn((slot: string) => {
      if (slot === 'pace-slow-light') return Promise.resolve('blob:custom-slow-light')
      return Promise.resolve(null)
    }) as any
    const removeMock = vi.fn().mockResolvedValue(undefined)
    window.omnitermAPI.customArt.remove = removeMock
    const refreshCustomArt = vi.fn()
    const display = { ...DEFAULT_QUOTA_CONFIG.display, customArtSession: true }

    await act(async () => {
      refreshPaceArt()
    })

    await act(async () => {
      render(<LoadingArtSettings display={display} onChange={vi.fn()} refreshCustomArt={refreshCustomArt} />)
    })

    const removeBtn = screen.getByRole('button', { name: 'Remove custom Slow light mode artwork' })
    expect(removeBtn).toBeInTheDocument()

    // Click remove
    await act(async () => {
      fireEvent.click(removeBtn)
    })
    expect(removeMock).toHaveBeenCalledWith('pace-slow-light')
    expect(refreshCustomArt).toHaveBeenCalled()

    // Removal failure does not throw
    removeMock.mockRejectedValueOnce(new Error('Remove failed'))
    await act(async () => {
      fireEvent.click(removeBtn)
    })
    expect(removeBtn).toBeEnabled()
  })
})
