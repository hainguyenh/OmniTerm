export const matchShortcut = (event: KeyboardEvent | React.KeyboardEvent, shortcutStr: string): boolean => {
  if (!shortcutStr) return false
  const parts = shortcutStr.split('+').map(p => p.trim().toLowerCase())
  const hasCtrl = parts.includes('ctrl') || parts.includes('commandorcontrol') || parts.includes('cmd')
  const hasShift = parts.includes('shift')
  const hasAlt = parts.includes('alt')
  
  const modifiers = ['ctrl', 'shift', 'alt', 'meta', 'commandorcontrol', 'cmd']
  const keyPart = parts.find(p => !modifiers.includes(p))
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
