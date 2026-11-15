/** Turns a keydown into the `Ctrl+Shift+Key` spelling stored in `settings.shortcuts`; null for a bare modifier. */
export function comboFromKeyEvent(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string | null {
  if (['control', 'shift', 'alt', 'meta'].includes(e.key.toLowerCase())) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  let key = e.key === ' ' ? 'Space' : e.key
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}
