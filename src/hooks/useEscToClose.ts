import { useEffect } from 'react'

/**
 * Close a dialog when the user presses Escape.
 *
 * When `dirty` is true (the user has unsaved edits) Escape routes to `onGuard`
 * — typically opening a "discard changes?" confirmation — instead of closing.
 * When `dirty` is false Escape calls `onClose` immediately.
 *
 * This guard applies only to the Escape shortcut. Explicit close affordances
 * (the X button, backdrop click) should call their close handler directly so
 * they always dismiss without a prompt.
 *
 * Pass `enabled: false` to suspend the listener (e.g. while the confirm prompt
 * is already open) so a second Escape doesn't re-trigger the guard.
 */
export function useEscToClose(
  dirty: boolean,
  onClose: () => void,
  onGuard: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (dirty) onGuard()
      else onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [dirty, onClose, onGuard, enabled])
}
