/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import CustomArtSettings from '../CustomArtSettings'

function renderArt(overrides: Record<string, unknown> = {}) {
  const props = {
    idleArtUrlLight: null,
    idleArtUrlDark: 'blob:idle-dark',
    loadingArtUrlLight: 'blob:loading-light',
    loadingArtUrlDark: null,
    onArtChanged: vi.fn(),
    ...overrides,
  }
  return { ...render(<CustomArtSettings {...props} />), props }
}

beforeEach(() => mockOmnitermAPI({ customArt: { upload: vi.fn(async () => 'blob:new'), remove: vi.fn(async () => {}) } }))

describe('CustomArtSettings complete behavior', () => {
  it('renders default and custom cards with previews and badges', () => {
    renderArt()
    expect(screen.getAllByText('Default')).toHaveLength(2)
    expect(screen.getAllByText('Custom')).toHaveLength(2)
    expect(screen.getByAltText('Idle (Dark)')).toHaveAttribute('src', 'blob:idle-dark')
    expect(screen.getByAltText('Loading (Light)')).toHaveAttribute('src', 'blob:loading-light')
    expect(screen.getAllByRole('button', { name: /to default artwork/ })).toHaveLength(2)
  })

  it('uploads every slot, shows busy text, and refreshes after success', async () => {
    let resolve: ((value: string) => void) | undefined
    vi.mocked(window.omnitermAPI.customArt.upload).mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const x = renderArt()
    const buttons = screen.getAllByText('Upload')
    fireEvent.click(buttons[0])
    expect(screen.getByText('Uploading…')).toBeDisabled()
    resolve?.('blob:new')
    await waitFor(() => expect(x.props.onArtChanged).toHaveBeenCalledTimes(1))

    for (const label of ['Idle (Dark)', 'Loading (Light)', 'Loading (Dark)']) {
      const card = screen.getByText(label).closest('.rounded-lg') as HTMLElement
      fireEvent.click(card.querySelector('button') as HTMLButtonElement)
    }
    await waitFor(() => expect(window.omnitermAPI.customArt.upload).toHaveBeenCalledTimes(4))
    expect(window.omnitermAPI.customArt.upload).toHaveBeenNthCalledWith(1, 'idle-light')
    expect(window.omnitermAPI.customArt.upload).toHaveBeenNthCalledWith(2, 'idle-dark')
    expect(window.omnitermAPI.customArt.upload).toHaveBeenNthCalledWith(3, 'loading-light')
    expect(window.omnitermAPI.customArt.upload).toHaveBeenNthCalledWith(4, 'loading-dark')
    expect(x.props.onArtChanged).toHaveBeenCalledTimes(4)
  })

  it('ignores upload and remove errors but refreshes successful removals', async () => {
    vi.mocked(window.omnitermAPI.customArt.upload).mockRejectedValueOnce(new Error('cancel'))
    vi.mocked(window.omnitermAPI.customArt.remove)
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(undefined)
    const x = renderArt()
    fireEvent.click(screen.getAllByText('Upload')[0])
    await waitFor(() => expect(screen.queryByText('Uploading…')).not.toBeInTheDocument())
    expect(x.props.onArtChanged).not.toHaveBeenCalled()

    const resets = screen.getAllByRole('button', { name: /to default artwork/ })
    fireEvent.click(resets[0])
    await waitFor(() => expect(window.omnitermAPI.customArt.remove).toHaveBeenCalledWith('idle-dark'))
    expect(x.props.onArtChanged).not.toHaveBeenCalled()
    fireEvent.click(resets[1])
    await waitFor(() => expect(x.props.onArtChanged).toHaveBeenCalledTimes(1))
    expect(window.omnitermAPI.customArt.remove).toHaveBeenLastCalledWith('loading-light')
  })
})
