import { useState, useCallback, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DialogTone = 'info' | 'warning' | 'error' | 'success'

interface AlertOptions {
  title?: string
  tone?: DialogTone
  buttonLabel?: string
}

interface ConfirmOptions {
  title?: string
  tone?: DialogTone
  confirmLabel?: string
  cancelLabel?: string
}

// Internal state shape
type DialogState =
  | { kind: 'alert'; title: string; message: string; tone: DialogTone; buttonLabel: string; resolve: () => void }
  | { kind: 'confirm'; title: string; message: string; tone: DialogTone; confirmLabel: string; cancelLabel: string; resolve: (v: boolean) => void }
  | null

export interface UseDialogReturn {
  dialogState: DialogState
  showAlert: (message: string, options?: AlertOptions) => Promise<void>
  showConfirm: (message: string, options?: ConfirmOptions) => Promise<boolean>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Provides promise-based showAlert / showConfirm that drive a custom themed
 * dialog rendered by <DialogHost>. Call the hook once at the top of your
 * component tree and pass `dialogState` down to <DialogHost>.
 */
export function useDialog(): UseDialogReturn {
  const [dialogState, setDialogState] = useState<DialogState>(null)
  // Keep a stable ref so callers can queue dialogs without stale captures
  const dialogStateRef = useRef<DialogState>(null)

  const showAlert = useCallback(
    (message: string, opts: AlertOptions = {}): Promise<void> =>
      new Promise<void>(resolve => {
        const state: DialogState = {
          kind: 'alert',
          title: opts.title ?? toneToTitle(opts.tone ?? 'info'),
          message,
          tone: opts.tone ?? 'info',
          buttonLabel: opts.buttonLabel ?? 'OK',
          resolve: () => {
            setDialogState(null)
            dialogStateRef.current = null
            resolve()
          },
        }
        dialogStateRef.current = state
        setDialogState(state)
      }),
    []
  )

  const showConfirm = useCallback(
    (message: string, opts: ConfirmOptions = {}): Promise<boolean> =>
      new Promise<boolean>(resolve => {
        const state: DialogState = {
          kind: 'confirm',
          title: opts.title ?? toneToTitle(opts.tone ?? 'warning'),
          message,
          tone: opts.tone ?? 'warning',
          confirmLabel: opts.confirmLabel ?? 'OK',
          cancelLabel: opts.cancelLabel ?? 'Cancel',
          resolve: (v: boolean) => {
            setDialogState(null)
            dialogStateRef.current = null
            resolve(v)
          },
        }
        dialogStateRef.current = state
        setDialogState(state)
      }),
    []
  )

  return { dialogState, showAlert, showConfirm }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toneToTitle(tone: DialogTone): string {
  switch (tone) {
    case 'error':   return 'Error'
    case 'warning': return 'Warning'
    case 'success': return 'Success'
    default:        return 'Info'
  }
}
