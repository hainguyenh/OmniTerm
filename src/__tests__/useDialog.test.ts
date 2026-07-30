/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDialog } from '../hooks/useDialog'

// ── useDialog ─────────────────────────────────────────────────────────────────

describe('useDialog', () => {
  it('starts with no active dialog', () => {
    const { result } = renderHook(() => useDialog())
    expect(result.current.dialogState).toBeNull()
  })

  // ── showAlert ──────────────────────────────────────────────────────────────

  describe('showAlert', () => {
    it('sets dialogState.kind to "alert" with the provided message', async () => {
      const { result } = renderHook(() => useDialog())

      act(() => { result.current.showAlert('Something went wrong.') })

      expect(result.current.dialogState?.kind).toBe('alert')
      expect(result.current.dialogState?.message).toBe('Something went wrong.')
    })

    it('uses default title "Info" when no options given', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showAlert('Hello') })
      expect(result.current.dialogState?.title).toBe('Info')
    })

    it('accepts a custom title and tone', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showAlert('Disk full', { title: 'Storage Error', tone: 'error' }) })
      const s = result.current.dialogState
      expect(s?.title).toBe('Storage Error')
      expect((s as { tone?: string })?.tone).toBe('error')
    })

    it('uses a custom buttonLabel', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showAlert('Done', { buttonLabel: 'Got it' }) })
      const s = result.current.dialogState
      expect((s as { buttonLabel?: string })?.buttonLabel).toBe('Got it')
    })

    it('defaults buttonLabel to "OK"', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showAlert('Hi') })
      const s = result.current.dialogState
      expect((s as { buttonLabel?: string })?.buttonLabel).toBe('OK')
    })

    it('resolves the promise and clears dialogState when resolve() called', async () => {
      const { result } = renderHook(() => useDialog())
      let resolved = false

      act(() => {
        result.current.showAlert('msg').then(() => { resolved = true })
      })

      expect(result.current.dialogState).not.toBeNull()

      // Simulate user clicking OK
      act(() => {
        if (result.current.dialogState?.kind === 'alert') {
          result.current.dialogState.resolve()
        }
      })

      expect(result.current.dialogState).toBeNull()
      // Allow microtasks to flush
      await act(async () => {})
      expect(resolved).toBe(true)
    })

    it('maps tone "warning" to title "Warning" when no explicit title given', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showAlert('oops', { tone: 'warning' }) })
      expect(result.current.dialogState?.title).toBe('Warning')
    })

    it('maps tone "error" to title "Error"', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showAlert('boom', { tone: 'error' }) })
      expect(result.current.dialogState?.title).toBe('Error')
    })

    it('maps tone "success" to title "Success"', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showAlert('done', { tone: 'success' }) })
      expect(result.current.dialogState?.title).toBe('Success')
    })
  })

  // ── showConfirm ────────────────────────────────────────────────────────────

  describe('showConfirm', () => {
    it('sets dialogState.kind to "confirm"', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showConfirm('Are you sure?') })
      expect(result.current.dialogState?.kind).toBe('confirm')
    })

    it('stores the message', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showConfirm('Delete this?') })
      expect(result.current.dialogState?.message).toBe('Delete this?')
    })

    it('defaults confirmLabel to "OK" and cancelLabel to "Cancel"', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showConfirm('Sure?') })
      const s = result.current.dialogState
      expect((s as { confirmLabel?: string })?.confirmLabel).toBe('OK')
      expect((s as { cancelLabel?: string })?.cancelLabel).toBe('Cancel')
    })

    it('accepts custom confirmLabel and cancelLabel', () => {
      const { result } = renderHook(() => useDialog())
      act(() => {
        result.current.showConfirm('Delete?', { confirmLabel: 'Delete', cancelLabel: 'Keep' })
      })
      const s = result.current.dialogState
      expect((s as { confirmLabel?: string })?.confirmLabel).toBe('Delete')
      expect((s as { cancelLabel?: string })?.cancelLabel).toBe('Keep')
    })

    it('resolves true when resolve(true) called', async () => {
      const { result } = renderHook(() => useDialog())
      let answer: boolean | null = null

      act(() => {
        result.current.showConfirm('Delete?').then(v => { answer = v })
      })

      act(() => {
        if (result.current.dialogState?.kind === 'confirm') {
          result.current.dialogState.resolve(true)
        }
      })

      await act(async () => {})
      expect(answer).toBe(true)
      expect(result.current.dialogState).toBeNull()
    })

    it('resolves false when resolve(false) called', async () => {
      const { result } = renderHook(() => useDialog())
      let answer: boolean | null = null

      act(() => {
        result.current.showConfirm('Delete?').then(v => { answer = v })
      })

      act(() => {
        if (result.current.dialogState?.kind === 'confirm') {
          result.current.dialogState.resolve(false)
        }
      })

      await act(async () => {})
      expect(answer).toBe(false)
      expect(result.current.dialogState).toBeNull()
    })

    it('uses default tone "warning" when no tone given', () => {
      const { result } = renderHook(() => useDialog())
      act(() => { result.current.showConfirm('Sure?') })
      expect((result.current.dialogState as { tone?: string })?.tone).toBe('warning')
    })
  })
})
