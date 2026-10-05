/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChangePosition, TextEditorHandle } from '../../editor/diffEditorModel'
import { GitDiffViewer } from '../GitDiffViewer'

const mockInvoke = vi.fn()
const goToChange = vi.fn()
let reportPosition: ((position: ChangePosition) => void) | undefined

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('../GitInlineDiffEditor', () => ({
  GitInlineDiffEditor: forwardRef<TextEditorHandle, { onChangePosition?: (position: ChangePosition) => void }>(
    function StubEditor(props, ref) {
      useImperativeHandle(ref, () => ({ getText: () => '', markSaved: vi.fn(), goToChange }))
      reportPosition = props.onChangePosition
      return <div data-testid="inline-editor" />
    },
  ),
}))

beforeEach(() => {
  goToChange.mockReset()
  reportPosition = undefined
  mockInvoke.mockReset().mockImplementation((cmd: string) => Promise.resolve(
    cmd === 'git_diff' ? { path: 'a.ts', is_binary: false, hunks: [] } : 'text',
  ))
})

async function renderViewer() {
  render(<GitDiffViewer cwd="/repo" filePath="a.ts" staged={false} inline onClose={vi.fn()} />)
  await screen.findByTestId('inline-editor')
}

describe('GitDiffViewer change navigation', () => {
  it('hides the change controls until the editor reports changes', async () => {
    await renderViewer()
    expect(screen.queryByRole('group', { name: 'Change navigation' })).toBeNull()
    act(() => reportPosition?.({ index: 0, count: 0 }))
    expect(screen.queryByRole('group', { name: 'Change navigation' })).toBeNull()
  })

  it('shows which change the cursor is on and steps through them', async () => {
    await renderViewer()
    act(() => reportPosition?.({ index: 1, count: 4 }))
    const group = screen.getByRole('group', { name: 'Change navigation' })
    expect(group).toHaveTextContent('2 / 4')
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    expect(goToChange).toHaveBeenLastCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Previous change' }))
    expect(goToChange).toHaveBeenLastCalledWith(-1)
    act(() => reportPosition?.({ index: -1, count: 4 }))
    expect(group).toHaveTextContent('– / 4')
  })

  it('jumps with F7 and Shift+F7 while focus is outside the editor', async () => {
    await renderViewer()
    fireEvent.keyDown(window, { key: 'F7' })
    expect(goToChange).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(window, { key: 'F7', shiftKey: true })
    expect(goToChange).toHaveBeenLastCalledWith(-1)
  })
})
