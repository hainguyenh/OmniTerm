export const matchShortcut = (event: KeyboardEvent | React.KeyboardEvent, shortcutStr: string): boolean => {
  if (!shortcutStr) return false

  const normalized = shortcutStr.trim().toLowerCase()
  // Splitting `Ctrl++` normally produces empty strings, making the explicit plus-key branch below
  // unreachable. Preserve a trailing plus as the actual key while discarding separator empties.
  const usesPlusKey = normalized === '+' || /\+\s*\+$/.test(normalized)
  const parts = normalized.split('+').map(part => part.trim()).filter(Boolean)
  if (usesPlusKey) parts.push('+')

  const hasCtrl = parts.includes('ctrl') || parts.includes('commandorcontrol') || parts.includes('cmd')
  const hasShift = parts.includes('shift')
  const hasAlt = parts.includes('alt')

  const modifiers = ['ctrl', 'shift', 'alt', 'meta', 'commandorcontrol', 'cmd']
  const keyPart = parts.find(part => !modifiers.includes(part))
  if (!keyPart) return false

  if (hasCtrl !== (event.ctrlKey || event.metaKey)) return false
  if (hasShift !== event.shiftKey) return false
  if (hasAlt !== event.altKey) return false

  const eventKey = event.key.toLowerCase()
  if (keyPart === '+' || keyPart === '=') {
    return eventKey === '+' || eventKey === '=' || event.code === 'NumpadAdd'
  }
  if (keyPart === '-') {
    return eventKey === '-' || event.code === 'NumpadSubtract'
  }
  return eventKey === keyPart
}
