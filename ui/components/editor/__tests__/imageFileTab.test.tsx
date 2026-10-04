/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceScript } from '@omniterm/contract'

import { mockOmnitermAPI } from '../../../testUtils'
import { EditorTabHost } from '../EditorTabHost'
import { ImageFileTab } from '../ImageFileTab'

vi.mock('../FileEditorTab', () => ({
  FileEditorTab: ({ script }: { script: WorkspaceScript }) => <div data-testid="text-editor">{script.name}</div>,
}))

const script = (name: string): WorkspaceScript => ({
  id: `f/${name}`, name, path: `f/${name}`, kind: name.split('.').pop() ?? 'file', viewable: false,
})

let openImageFile: ReturnType<typeof vi.fn>
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  openImageFile = vi.fn(async () => new Uint8Array([137, 80, 78, 71]))
  mockOmnitermAPI({ workspace: { openImageFile } })
  let next = 0
  createObjectURL = vi.fn(() => `blob:image-${++next}`)
  revokeObjectURL = vi.fn()
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
})

afterEach(() => vi.clearAllMocks())

describe('ImageFileTab', () => {
  it('reads the bytes once visible and shows them as a typed blob image', async () => {
    const { rerender, unmount } = render(<ImageFileTab workspaceId="w" script={script('logo.PNG')} visible={false} onClose={vi.fn()} />)
    expect(openImageFile).not.toHaveBeenCalled()

    rerender(<ImageFileTab workspaceId="w" script={script('logo.PNG')} visible onClose={vi.fn()} />)
    const image = await screen.findByRole('img', { name: 'logo.PNG' })
    expect(openImageFile).toHaveBeenCalledWith('w', 'f/logo.PNG')
    expect(image).toHaveAttribute('src', 'blob:image-1')
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(4)
    expect(screen.getByText('4 B')).toBeInTheDocument()
    // The breadcrumb header is shared with text files, without save or view-mode controls.
    expect(screen.getByRole('navigation', { name: 'File path' })).toHaveTextContent('logo.PNG')
    expect(screen.queryByRole('group', { name: 'View mode' })).toBeNull()

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-1')
  })

  it('shows the backend refusal and retries on request', async () => {
    openImageFile.mockRejectedValueOnce(new Error('This image is 30.0 MB and the viewer limit is 25.0 MB.'))
    render(<ImageFileTab workspaceId="w" script={script('huge.gif')} visible onClose={vi.fn()} />)
    expect(await screen.findByText(/viewer limit is 25.0 MB/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('img', { name: 'huge.gif' })).toBeInTheDocument()
    expect(openImageFile).toHaveBeenCalledTimes(2)
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('image/gif')
  })

  it('reports a string rejection as-is and ignores answers after closing', async () => {
    openImageFile.mockRejectedValueOnce('denied')
    const first = render(<ImageFileTab workspaceId="w" script={script('a.ico')} visible onClose={vi.fn()} />)
    expect(await screen.findByText('denied')).toBeInTheDocument()
    first.unmount()

    let resolve: (bytes: Uint8Array) => void = () => {}
    openImageFile.mockImplementationOnce(() => new Promise<Uint8Array>((done) => { resolve = done }))
    const late = render(<ImageFileTab workspaceId="w" script={script('b.webp')} visible onClose={vi.fn()} />)
    late.unmount()
    await act(async () => { resolve(new Uint8Array([1])) })
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})

describe('EditorTabHost routing', () => {
  const host = (name: string) => (
    <EditorTabHost tabId="t" editor={{ workspaceId: 'w', script: script(name) }} visible
      closeTab={vi.fn()} keepTab={vi.fn()} runScript={vi.fn()} setEditorDirty={vi.fn()} />
  )

  it('opens raster images in the image viewer and everything else in the text editor', async () => {
    const { unmount } = render(host('photo.jpeg'))
    expect(await screen.findByRole('img', { name: 'photo.jpeg' })).toBeInTheDocument()
    unmount()

    render(host('icon.svg'))
    expect(await screen.findByTestId('text-editor')).toHaveTextContent('icon.svg')
    await waitFor(() => expect(openImageFile).toHaveBeenCalledTimes(1))
  })
})
