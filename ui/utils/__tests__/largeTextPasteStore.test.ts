/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelLargeTextPasteForSession,
  getLargeTextPasteRequest,
  requestLargeTextPasteDecision,
  resolveLargeTextPaste,
  subscribeLargeTextPaste,
} from '../largeTextPasteStore'

describe('largeTextPasteStore', () => {
  beforeEach(() => {
    resolveLargeTextPaste('cancel')
  })

  it('resolves immediately to "paste" when there are no subscribers', async () => {
    const decision = await requestLargeTextPasteDecision('s1', 'hello', 5, 1, 'hello')
    expect(decision).toBe('paste')
    expect(getLargeTextPasteRequest()).toBeNull()
  })

  it('stores active request and notifies subscribers', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLargeTextPaste(listener)

    const promise = requestLargeTextPasteDecision('s1', 'long text', 1500, 20, 'long…')
    expect(listener).toHaveBeenCalledOnce()

    const req = getLargeTextPasteRequest()
    expect(req).not.toBeNull()
    expect(req?.sessionId).toBe('s1')
    expect(req?.charCount).toBe(1500)
    expect(req?.lineCount).toBe(20)
    expect(req?.preview).toBe('long…')

    resolveLargeTextPaste('attach')
    const decision = await promise
    expect(decision).toBe('attach')
    expect(getLargeTextPasteRequest()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2) // request + resolve

    unsubscribe()
  })

  it('cancels an active request when a new request is dispatched', async () => {
    const unsubscribe = subscribeLargeTextPaste(() => {})

    const firstPromise = requestLargeTextPasteDecision('s1', 'text 1', 1200, 10, 'preview 1')
    const secondPromise = requestLargeTextPasteDecision('s2', 'text 2', 1800, 15, 'preview 2')

    const firstDecision = await firstPromise
    expect(firstDecision).toBe('cancel')

    resolveLargeTextPaste('paste')
    const secondDecision = await secondPromise
    expect(secondDecision).toBe('paste')

    unsubscribe()
  })

  it('cancels an active request for a specific session', async () => {
    const unsubscribe = subscribeLargeTextPaste(() => {})

    const promise = requestLargeTextPasteDecision('s1', 'text', 1400, 12, 'preview')
    cancelLargeTextPasteForSession('s1')

    const decision = await promise
    expect(decision).toBe('cancel')
    expect(getLargeTextPasteRequest()).toBeNull()

    unsubscribe()
  })
})
