/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ide/editor/core/controller', () => ({
  editorController: () => ({
    manager: {
      get: () => ({
        sync: { localText: { toString: () => '# Heading\nSample content' } },
      }),
    },
    slotFor: () => null,
  }),
}))

import {
  resolveFileEditor,
  textEditorWrapperFor,
  useContributions,
  useTextEditorWrappers,
} from '../../ide/workbench/contributions'
import { PreviewTabActions, PreviewWrapper } from '../previews/PreviewWrapper'
import { usePreviewModeStore } from '../previews/previewKinds'
import { registerPreviewKinds } from '../registerPreviewKinds'

describe('registerPreviewKinds', () => {
  let release: (() => void) | null = null

  beforeEach(() => {
    usePreviewModeStore.setState({ modes: {} })
  })

  afterEach(() => {
    if (release) {
      release()
      release = null
    }
  })

  it('registers raster image provider that resolves image paths to image editor kind', async () => {
    release = registerPreviewKinds()

    const pngRes = await resolveFileEditor('photos/sunset.png')
    expect(pngRes?.input).toEqual({
      kind: 'image',
      key: 'photos/sunset.png',
      path: 'photos/sunset.png',
    })

    const jpegRes = await resolveFileEditor('photos/cat.jpeg')
    expect(jpegRes?.input.kind).toBe('image')

    const nonImage = await resolveFileEditor('src/main.rs')
    expect(nonImage).toBeNull()

    const mdFile = await resolveFileEditor('docs/index.md')
    expect(mdFile).toBeNull()
  })

  it('registers image and notes editor kinds', () => {
    release = registerPreviewKinds()

    const imageKind = useContributions.getState().editorKinds.get('image')
    expect(imageKind).toBeDefined()
    expect(imageKind?.icon?.({ kind: 'image', key: 'test.png' })).toBe('image')
    expect(imageKind?.title({ kind: 'image', key: 'test.png', path: 'dir/test.png' })).toBe('test.png')
    expect(imageKind?.keepAlive).toBe(true)

    const notesKind = useContributions.getState().editorKinds.get('notes')
    expect(notesKind).toBeDefined()
    expect(notesKind?.icon?.({ kind: 'notes', key: 'notes:1' })).toBe('sticky-note')
    expect(notesKind?.title({ kind: 'notes', key: 'notes:1', data: { title: 'My Note' } })).toBe('My Note')
    expect(notesKind?.keepAlive).toBe(true)
  })

  it('registers text editor wrappers matching markdown, csv, json, html, and svg', () => {
    release = registerPreviewKinds()
    const wrappers = useTextEditorWrappers.getState().wrappers

    const md = textEditorWrapperFor(wrappers, 'README.md')
    expect(md?.id).toBe('omniterm.markdown-wrapper')

    const csv = textEditorWrapperFor(wrappers, 'metrics.csv')
    expect(csv?.id).toBe('omniterm.csv-wrapper')

    const tsv = textEditorWrapperFor(wrappers, 'metrics.tsv')
    expect(tsv?.id).toBe('omniterm.csv-wrapper')

    const json = textEditorWrapperFor(wrappers, 'config.json')
    expect(json?.id).toBe('omniterm.json-graph-wrapper')

    const html = textEditorWrapperFor(wrappers, 'index.html')
    expect(html?.id).toBe('omniterm.html-wrapper')

    const svg = textEditorWrapperFor(wrappers, 'logo.svg')
    expect(svg?.id).toBe('omniterm.svg-wrapper')

    const rust = textEditorWrapperFor(wrappers, 'main.rs')
    expect(rust).toBeUndefined()
  })

  it('unregisters all contributions and wrappers when disposed', async () => {
    release = registerPreviewKinds()
    release()
    release = null

    const pngRes = await resolveFileEditor('photos/sunset.png')
    expect(pngRes).toBeNull()

    const wrappers = useTextEditorWrappers.getState().wrappers
    expect(textEditorWrapperFor(wrappers, 'README.md')).toBeUndefined()
    expect(textEditorWrapperFor(wrappers, 'data.csv')).toBeUndefined()
  })

  it('puts the view-mode switch in the tab strip and forwards whether it is shown there', () => {
    release = registerPreviewKinds()
    const md = textEditorWrapperFor(useTextEditorWrappers.getState().wrappers, 'README.md')
    const TabActions = md?.tabActions
    const Wrapper = md?.component
    expect(TabActions).toBeDefined()
    expect(Wrapper).toBeDefined()
    if (!TabActions || !Wrapper) return

    const strip = render(<TabActions path="README.md" tabId="tab-strip" />)
    expect(screen.getByRole('button', { name: 'Preview only' })).toBeTruthy()
    strip.unmount()

    render(
      <Wrapper path="README.md" tabId="tab-strip" actionsInTabs>
        <div />
      </Wrapper>,
    )
    expect(screen.queryByRole('group', { name: 'View mode' })).toBeNull()
  })

  it('floats the view-mode switch over the code only while the tab strip does not show it', () => {
    const { rerender } = render(
      <PreviewWrapper kind="markdown" path="readme.md" tabId="tab-float" actionsInTabs>
        <div />
      </PreviewWrapper>,
    )
    expect(screen.queryByRole('group', { name: 'View mode' })).toBeNull()

    rerender(
      <PreviewWrapper kind="markdown" path="readme.md" tabId="tab-float">
        <div />
      </PreviewWrapper>,
    )
    expect(screen.getAllByRole('group', { name: 'View mode' })).toHaveLength(1)
  })

  it('renders PreviewTabActions and toggles preview mode', () => {
    render(<PreviewTabActions tabId="tab-test-1" />)

    const codeBtn = screen.getByRole('button', { name: 'Editor only' })
    const splitBtn = screen.getByRole('button', { name: 'Split editor and preview' })
    const previewBtn = screen.getByRole('button', { name: 'Preview only' })

    expect(codeBtn).toBeTruthy()
    expect(splitBtn).toBeTruthy()
    expect(previewBtn).toBeTruthy()

    // Default mode is split
    expect(splitBtn.getAttribute('aria-pressed')).toBe('true')

    act(() => {
      fireEvent.click(previewBtn)
    })
    expect(usePreviewModeStore.getState().modes['tab-test-1']).toBe('preview')
    expect(previewBtn.getAttribute('aria-pressed')).toBe('true')

    act(() => {
      fireEvent.click(codeBtn)
    })
    expect(usePreviewModeStore.getState().modes['tab-test-1']).toBe('code')
    expect(codeBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('renders PreviewWrapper preserving children in the DOM across modes', () => {
    const { rerender } = render(
      <PreviewWrapper kind="markdown" path="readme.md" tabId="tab-test-2">
        <div data-testid="cm-editor-content">CodeMirror Host</div>
      </PreviewWrapper>,
    )

    const editorEl = screen.getByTestId('cm-editor-content')
    expect(editorEl).toBeTruthy()

    // Toggle to preview mode
    act(() => {
      usePreviewModeStore.getState().setMode('tab-test-2', 'preview')
    })
    rerender(
      <PreviewWrapper kind="markdown" path="readme.md" tabId="tab-test-2">
        <div data-testid="cm-editor-content">CodeMirror Host</div>
      </PreviewWrapper>,
    )

    // Children are retained in DOM (display: none)
    expect(screen.getByTestId('cm-editor-content')).toBe(editorEl)
    expect(editorEl.parentElement?.style.display).toBe('none')

    // Toggle to code mode
    act(() => {
      usePreviewModeStore.getState().setMode('tab-test-2', 'code')
    })
    rerender(
      <PreviewWrapper kind="markdown" path="readme.md" tabId="tab-test-2">
        <div data-testid="cm-editor-content">CodeMirror Host</div>
      </PreviewWrapper>,
    )

    expect(screen.getByTestId('cm-editor-content')).toBe(editorEl)
    expect(editorEl.parentElement?.style.display).not.toBe('none')
  })
})
