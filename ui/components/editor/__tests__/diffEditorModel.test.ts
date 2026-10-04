import { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyLanguage, createDirtyTracker, detectEol, diffConfigFor, diffProfileFor, measureText,
} from '../diffEditorModel'
import { LARGE_FILE_CHARS, LONG_LINE_CHARS } from '../fileProfile'

const doc = (text: string) => Text.of(text.split('\n'))

describe('detectEol', () => {
  it('keeps CRLF only when the loaded text used it', () => {
    expect(detectEol('a\r\nb')).toBe('crlf')
    expect(detectEol('a\nb')).toBe('lf')
    expect(detectEol('')).toBe('lf')
  })
})

describe('measureText', () => {
  it('counts characters, lines and the longest line', () => {
    expect(measureText('')).toEqual({ chars: 0, lines: 1, maxLineLen: 0 })
    expect(measureText('ab\nabcd\nx')).toEqual({ chars: 9, lines: 3, maxLineLen: 4 })
    expect(measureText('abc\n')).toEqual({ chars: 4, lines: 2, maxLineLen: 3 })
  })
})

describe('diffProfileFor', () => {
  it('takes the more restrictive profile of the two sides', () => {
    expect(diffProfileFor('a', 'b')).toBe('full')
    expect(diffProfileFor('x'.repeat(LONG_LINE_CHARS + 1), 'b')).toBe('longLines')
    expect(diffProfileFor('a', 'x'.repeat(LARGE_FILE_CHARS + 1))).toBe('large')
    expect(diffProfileFor('x'.repeat(LONG_LINE_CHARS + 1), 'x'.repeat(LARGE_FILE_CHARS + 1))).toBe('large')
  })
})

describe('diffConfigFor', () => {
  it('bounds the diff tighter outside the full profile', () => {
    const full = diffConfigFor('full')
    const large = diffConfigFor('large')
    expect(full.timeout).toBeGreaterThan(large.timeout ?? 0)
    expect(full.scanLimit).toBeGreaterThan(large.scanLimit ?? 0)
  })
})

describe('createDirtyTracker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports only flips, deferring equal-length comparisons', () => {
    vi.useFakeTimers()
    const onDirty = vi.fn()
    const tracker = createDirtyTracker(onDirty)
    const saved = doc('abc')
    tracker.reset(saved)
    expect(onDirty).not.toHaveBeenCalled()

    tracker.update(doc('abcd'))
    tracker.update(doc('abcde'))
    expect(onDirty.mock.calls).toEqual([[true]])

    tracker.update(doc('abc'))
    expect(onDirty).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(200)
    expect(onDirty.mock.calls).toEqual([[true], [false]])

    tracker.update(doc('xyz'))
    vi.advanceTimersByTime(200)
    expect(onDirty.mock.calls).toEqual([[true], [false], [true]])

    tracker.reset(doc('xyz'))
    expect(onDirty.mock.calls).toEqual([[true], [false], [true], [false]])
  })

  it('treats the saved document itself as clean and drops a pending check on dispose', () => {
    vi.useFakeTimers()
    const onDirty = vi.fn()
    const tracker = createDirtyTracker(onDirty)
    const saved = doc('abc')
    tracker.reset(saved)
    tracker.update(saved)
    tracker.update(doc('xyz'))
    tracker.dispose()
    vi.advanceTimersByTime(200)
    expect(onDirty).not.toHaveBeenCalled()
  })
})

describe('applyLanguage', () => {
  const fakeView = () => ({ dispatch: vi.fn() })

  it('installs the grammar in every view', async () => {
    const views = [fakeView(), fakeView()]
    await applyLanguage(() => views as unknown as EditorView[], 'src\\lib.json', 'full', () => true)
    for (const view of views) expect(view.dispatch).toHaveBeenCalledTimes(1)
  })

  it('skips plain text, restricted profiles and views destroyed while loading', async () => {
    const view = fakeView()
    const views = () => [view] as unknown as EditorView[]
    await applyLanguage(views, 'notes.unknownext', 'full', () => true)
    await applyLanguage(views, 'big.json', 'large', () => true)
    await applyLanguage(views, 'gone.json', 'full', () => false)
    expect(view.dispatch).not.toHaveBeenCalled()
  })
})
