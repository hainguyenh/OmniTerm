/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import LargeTextPasteModalHost from '../LargeTextPasteModalHost'
import {
  requestLargeTextPasteDecision,
  resolveLargeTextPaste,
} from '../../utils/largeTextPasteStore'

describe('LargeTextPasteModalHost', () => {
  beforeEach(() => {
    act(() => resolveLargeTextPaste('cancel'))
  })

  afterEach(() => {
    act(() => resolveLargeTextPaste('cancel'))
  })

  it('renders nothing when there is no active paste request', () => {
    const { container } = render(<LargeTextPasteModalHost />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the dialog when a large paste request arrives', async () => {
    render(<LargeTextPasteModalHost />)

    let promise!: Promise<'attach' | 'paste' | 'cancel'>
    act(() => {
      promise = requestLargeTextPasteDecision(
        'sess-1',
        'const a = 1;\nconst b = 2;',
        1500,
        12,
        'const a = 1;…',
      )
    })

    expect(screen.getByRole('dialog', { name: 'Large Text Paste' })).toBeInTheDocument()
    expect(screen.getByText('1,500 characters · 12 lines')).toBeInTheDocument()
    expect(screen.getByText('const a = 1;…')).toBeInTheDocument()

    // Click Attach
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Attach as Document/i }))
    })
    const decision = await promise
    expect(decision).toBe('attach')

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves with "paste" when clicking Paste Directly', async () => {
    render(<LargeTextPasteModalHost />)

    let promise!: Promise<'attach' | 'paste' | 'cancel'>
    act(() => {
      promise = requestLargeTextPasteDecision('sess-1', 'raw text', 1200, 5, 'raw…')
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Paste Directly/i }))
    })

    const decision = await promise
    expect(decision).toBe('paste')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves with "cancel" when clicking Cancel or close button', async () => {
    render(<LargeTextPasteModalHost />)

    let promise!: Promise<'attach' | 'paste' | 'cancel'>
    act(() => {
      promise = requestLargeTextPasteDecision('sess-1', 'text', 1100, 3, 'preview')
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel paste' }))
    })

    const decision = await promise
    expect(decision).toBe('cancel')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('handles keyboard shortcuts: Enter, Ctrl+Enter, and Escape', async () => {
    render(<LargeTextPasteModalHost />)

    // Test Enter -> attach
    let promise!: Promise<'attach' | 'paste' | 'cancel'>
    act(() => {
      promise = requestLargeTextPasteDecision('sess-1', 'text 1', 1100, 3, 'p1')
    })
    act(() => {
      fireEvent.keyDown(document, { key: 'Enter' })
    })
    expect(await promise).toBe('attach')

    // Test Ctrl+Enter -> paste
    act(() => {
      promise = requestLargeTextPasteDecision('sess-1', 'text 2', 1200, 4, 'p2')
    })
    act(() => {
      fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    })
    expect(await promise).toBe('paste')

    // Test Escape -> cancel
    act(() => {
      promise = requestLargeTextPasteDecision('sess-1', 'text 3', 1300, 5, 'p3')
    })
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(await promise).toBe('cancel')
  })

  it('cancels when clicking the backdrop', async () => {
    render(<LargeTextPasteModalHost />)

    let promise!: Promise<'attach' | 'paste' | 'cancel'>
    act(() => {
      promise = requestLargeTextPasteDecision('sess-1', 'text', 1400, 8, 'backdrop test')
    })
    const backdrop = screen.getByRole('presentation')
    act(() => {
      fireEvent.click(backdrop)
    })

    const decision = await promise
    expect(decision).toBe('cancel')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
