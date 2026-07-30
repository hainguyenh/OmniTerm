import React, { useEffect, useRef } from 'react'
import { AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react'
import type { DialogTone } from '../hooks/useDialog'

// ── Internal dialog state type (mirrored from useDialog to avoid a circular dep) ──
type DialogState =
  | { kind: 'alert'; title: string; message: string; tone: DialogTone; buttonLabel: string; resolve: () => void }
  | { kind: 'confirm'; title: string; message: string; tone: DialogTone; confirmLabel: string; cancelLabel: string; resolve: (v: boolean) => void }
  | null

interface DialogHostProps {
  dialogState: DialogState
}

// ── Tone → icon / color mapping using CSS variables ───────────────────────────
function toneConfig(tone: DialogTone) {
  switch (tone) {
    case 'error':
      return { Icon: XCircle, colorVar: 'var(--dialog-tone-error)' }
    case 'warning':
      return { Icon: AlertTriangle, colorVar: 'var(--dialog-tone-warning)' }
    case 'success':
      return { Icon: CheckCircle2, colorVar: 'var(--dialog-tone-success)' }
    default:
      return { Icon: Info, colorVar: 'var(--dialog-tone-info)' }
  }
}

// ── Shared modal wrapper ───────────────────────────────────────────────────────
interface ModalShellProps {
  title: string
  message: string
  tone: DialogTone
  onBackdrop: () => void
  children: React.ReactNode
}

const ModalShell: React.FC<ModalShellProps> = ({ title, message, tone, onBackdrop, children }) => {
  const { Icon, colorVar } = toneConfig(tone)

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onBackdrop()
  }

  return (
    <div
      className="nc-dialog-backdrop"
      onClick={handleBackdrop}
      role="presentation"
    >
      <div
        className="nc-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nc-dialog-title"
      >
        {/* Accent bar */}
        <div className="nc-dialog-accent-bar" style={{ background: colorVar }} />

        {/* Header */}
        <div className="nc-dialog-header">
          <Icon className="nc-dialog-icon" style={{ color: colorVar }} aria-hidden="true" />
          <h3 id="nc-dialog-title" className="nc-dialog-title">{title}</h3>
        </div>

        {/* Body */}
        <p className="nc-dialog-body">{message}</p>

        {/* Footer */}
        <div className="nc-dialog-footer">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Keyboard handler ──────────────────────────────────────────────────────────
/**
 * Listens for Escape (→ onEscape) and Enter (→ onEnter) at the document level
 * while the dialog is mounted. Both keys are prevented from bubbling so they
 * don't accidentally trigger underlying UI.
 */
function useDialogKeys(onEnter: () => void, onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape() }
      if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); onEnter() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onEnter, onEscape])
}

// ── AlertDialog ───────────────────────────────────────────────────────────────
interface AlertDialogProps {
  title: string
  message: string
  tone: DialogTone
  buttonLabel: string
  onClose: () => void
}

const AlertDialog: React.FC<AlertDialogProps> = ({ title, message, tone, buttonLabel, onClose }) => {
  const btnRef = useRef<HTMLButtonElement>(null)

  // Enter or Escape both dismiss the alert (single-action dialog)
  useDialogKeys(onClose, onClose)

  useEffect(() => { btnRef.current?.focus() }, [])

  return (
    <ModalShell title={title} message={message} tone={tone} onBackdrop={onClose}>
      <button
        ref={btnRef}
        type="button"
        className="nc-dialog-btn-primary"
        onClick={onClose}
        id="nc-dialog-ok"
      >
        {buttonLabel}
      </button>
    </ModalShell>
  )
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────────
interface ConfirmDialogProps {
  title: string
  message: string
  tone: DialogTone
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmDialogInner: React.FC<ConfirmDialogProps> = ({
  title, message, tone, confirmLabel, cancelLabel, onConfirm, onCancel,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Enter → confirm (primary action), Escape → safe cancel
  useDialogKeys(onConfirm, onCancel)

  useEffect(() => { cancelRef.current?.focus() }, [])

  return (
    <ModalShell title={title} message={message} tone={tone} onBackdrop={onCancel}>
      <button
        ref={cancelRef}
        type="button"
        className="nc-dialog-btn-cancel"
        onClick={onCancel}
        id="nc-dialog-cancel"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        className="nc-dialog-btn-destructive"
        onClick={onConfirm}
        id="nc-dialog-confirm"
      >
        {confirmLabel}
      </button>
    </ModalShell>
  )
}

// ── DialogHost (mount once near top of component tree) ───────────────────────
/**
 * Renders the active dialog driven by useDialog()'s `dialogState`.
 * Mount this once inside your root component alongside your other modals.
 */
const DialogHost: React.FC<DialogHostProps> = ({ dialogState }) => {
  if (!dialogState) return null

  if (dialogState.kind === 'alert') {
    return (
      <AlertDialog
        title={dialogState.title}
        message={dialogState.message}
        tone={dialogState.tone}
        buttonLabel={dialogState.buttonLabel}
        onClose={dialogState.resolve}
      />
    )
  }

  return (
    <ConfirmDialogInner
      title={dialogState.title}
      message={dialogState.message}
      tone={dialogState.tone}
      confirmLabel={dialogState.confirmLabel}
      cancelLabel={dialogState.cancelLabel}
      onConfirm={() => dialogState.resolve(true)}
      onCancel={() => dialogState.resolve(false)}
    />
  )
}

export default DialogHost
