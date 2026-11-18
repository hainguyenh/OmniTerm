/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executed = vi.hoisted(() => [] as Array<{ action: string; arg?: unknown }>)
vi.mock('../../ide/platform/actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ide/platform/actions')>()),
  executeAction: (action: string, arg?: unknown) => {
    executed.push({ action, arg })
    return Promise.resolve()
  },
}))
vi.mock('../../ide/editor/core/controller', () => ({
  editorController: () => ({
    manager: { get: () => ({ sync: { localText: { toString: () => '<h1>Hi</h1>' } } }) },
    slotFor: () => null,
  }),
}))

import { PreviewWrapper } from '../previews/PreviewWrapper'
import { usePreviewModeStore } from '../previews/previewKinds'

describe('HTML preview only mode', () => {
  beforeEach(() => {
    executed.length = 0
    act(() => usePreviewModeStore.setState({ modes: { t1: 'preview' } }))
  })

  it('keeps a bar to go back to the editor, even though the preview is an iframe', () => {
    render(<PreviewWrapper kind="html" path="/w/index.html" tabId="t1" />)
    const bar = screen.getByTestId('preview-only-bar')
    expect(bar.textContent).toContain('index.html')
    fireEvent.click(screen.getByRole('button', { name: 'Editor only' }))
    expect(usePreviewModeStore.getState().modes.t1).toBe('code')
  })

  it('hides the editor from the corner-actions lookup so the floating editor actions show up in every preview kind', () => {
    for (const kind of ['html', 'csv', 'svg', 'markdown', 'json-graph'] as const) {
      const { container, unmount } = render(
        <PreviewWrapper kind={kind} path={`/w/a.${kind}`} tabId="t1"><div className="cm-omniterm-corner" /></PreviewWrapper>,
      )
      const corner = container.querySelector('.cm-omniterm-corner')!
      expect(corner.closest('[aria-hidden="true"]'), kind).not.toBeNull()
      act(() => usePreviewModeStore.setState({ modes: { t1: 'split' } }))
      expect(corner.closest('[aria-hidden="true"]'), kind).toBeNull()
      act(() => usePreviewModeStore.setState({ modes: { t1: 'preview' } }))
      unmount()
    }
  })

  it('opens the file in the browser through the local server', () => {
    render(<PreviewWrapper kind="html" path="/w/index.html" tabId="t1" />)
    fireEvent.click(screen.getByTestId('preview-open-in-browser'))
    expect(executed).toEqual([{ action: 'web.openInBrowser', arg: { path: '/w/index.html' } }])
  })

  it('offers no browser button for other previews and no bar outside preview-only', () => {
    render(<PreviewWrapper kind="csv" path="/w/a.csv" tabId="t1" />)
    expect(screen.queryByTestId('preview-open-in-browser')).toBeNull()
    act(() => usePreviewModeStore.setState({ modes: { t1: 'split' } }))
    expect(screen.queryByTestId('preview-only-bar')).toBeNull()
  })
})
