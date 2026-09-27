import { useEffect, type RefObject } from 'react'

/** Closes the pane picker from the standard Escape and outside-click gestures. */
export function usePanePickerDismissal(
  panePicker: number | null,
  panePickerRef: RefObject<HTMLDivElement>,
  closePicker: (value: number | null) => void,
): void {
  useEffect(() => {
    if (panePicker === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePicker(null)
    }
    const onClick = (event: MouseEvent) => {
      if (panePickerRef.current && !panePickerRef.current.contains(event.target as Node)) closePicker(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [closePicker, panePicker, panePickerRef])
}
