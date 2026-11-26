/**
 * @vitest-environment jsdom
 */
/**
 * The section's own chrome: collapse toggle, info tooltip, and the Save affordance.
 *
 * `CustomArtSettings.coverage.test.tsx` drives the four art cards. Everything wrapped around them is
 * reachable only from the header and footer — and the Save button in particular has three distinct
 * states (hidden, enabled with a count, disabled and saying so) that the card tests never reach.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOmnitermAPI } from '../../testUtils'
import CustomArtSettings from '../CustomArtSettings'

const ALL_CUSTOM = {
  idleArtUrlLight: 'blob:idle-light',
  idleArtUrlDark: 'blob:idle-dark',
  loadingArtUrlLight: 'blob:loading-light',
  loadingArtUrlDark: 'blob:loading-dark',
}
const NONE_CUSTOM = {
  idleArtUrlLight: null,
  idleArtUrlDark: null,
  loadingArtUrlLight: null,
  loadingArtUrlDark: null,
}

function renderArt(overrides: Record<string, unknown> = {}) {
  const props = { ...NONE_CUSTOM, onArtChanged: vi.fn(), ...overrides }
  return { ...render(<CustomArtSettings {...props} />), props }
}

beforeEach(() => mockOmnitermAPI({
  customArt: { upload: vi.fn(async () => 'blob:new'), remove: vi.fn(async () => {}) },
}))

describe('header and direct display', () => {
  it('renders title, description, and cards directly without collapsing', () => {
    renderArt()
    expect(screen.getByText('Custom Pane Art')).toBeInTheDocument()
    expect(screen.getByText(/Upload custom images or GIFs/)).toBeInTheDocument()
    expect(screen.getAllByText('Upload')).toHaveLength(4)
  })
})

describe('info tooltip', () => {
  const TEXT = /Upload custom images or GIFs to replace the default/

  it('appears on hover and leaves on exit', () => {
    renderArt()
    const info = screen.getByLabelText('Pane Art info')
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument()

    fireEvent.mouseEnter(info)
    expect(screen.getByText(TEXT)).toBeInTheDocument()
    fireEvent.mouseLeave(info)
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument()
  })

  it('toggles on click', () => {
    renderArt()
    const info = screen.getByLabelText('Pane Art info')

    fireEvent.click(info)
    expect(screen.getByText(TEXT)).toBeInTheDocument()

    fireEvent.click(info)
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument()
  })
})

describe('Save affordance', () => {
  it('is absent while nothing is custom and nothing is pending', () => {
    renderArt()
    expect(screen.queryByText('All Saved')).not.toBeInTheDocument()
    expect(screen.queryByText(/Save Changes/)).not.toBeInTheDocument()
  })

  it('reads "All Saved" and is disabled when the art on disk is already current', () => {
    renderArt(ALL_CUSTOM)
    const save = screen.getByText('All Saved').closest('button') as HTMLButtonElement
    expect(save).toBeDisabled()
  })

  it('counts pending uploads, then clears them once saved', async () => {
    const x = renderArt()
    const uploads = screen.getAllByText('Upload')
    fireEvent.click(uploads[0])
    await waitFor(() => expect(screen.getByText('Save Changes (1)')).toBeInTheDocument())

    fireEvent.click(uploads[1])
    await waitFor(() => expect(screen.getByText('Save Changes (2)')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Save Changes (2)'))
    // One refresh per upload, plus the explicit save.
    expect(x.props.onArtChanged).toHaveBeenCalledTimes(3)
    // With nothing custom on disk either, the whole footer goes away again.
    expect(screen.queryByText(/Save Changes/)).not.toBeInTheDocument()
    expect(screen.queryByText('All Saved')).not.toBeInTheDocument()
  })

  it('drops a slot from the pending set when its upload is reset', async () => {
    renderArt(ALL_CUSTOM)
    fireEvent.click(screen.getAllByText('Upload')[0])
    await waitFor(() => expect(screen.getByText('Save Changes (1)')).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: /to default artwork/ })[0])
    await waitFor(() => expect(screen.getByText('All Saved')).toBeInTheDocument())
    expect(window.omnitermAPI.customArt.remove).toHaveBeenCalledWith('idle-light')
  })

  it('marks only the uploaded card as pending', async () => {
    renderArt(ALL_CUSTOM)
    expect(screen.getAllByText('Custom')).toHaveLength(4)

    fireEvent.click(screen.getAllByText('Upload')[2])
    await waitFor(() => expect(screen.getByText('Pending')).toBeInTheDocument())
    expect(screen.getAllByText('Custom')).toHaveLength(3)
    expect(window.omnitermAPI.customArt.upload).toHaveBeenCalledWith('loading-light')
  })
})

describe('remove wiring', () => {
  it('sends each slot its own identifier', async () => {
    renderArt(ALL_CUSTOM)
    const resets = screen.getAllByRole('button', { name: /to default artwork/ })
    for (const reset of resets) fireEvent.click(reset)
    await waitFor(() => expect(window.omnitermAPI.customArt.remove).toHaveBeenCalledTimes(4))
    expect(vi.mocked(window.omnitermAPI.customArt.remove).mock.calls.map(([slot]) => slot))
      .toEqual(['idle-light', 'idle-dark', 'loading-light', 'loading-dark'])
  })
})
