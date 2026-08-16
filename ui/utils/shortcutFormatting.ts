import type React from 'react'

/**
 * Splits a keyboard shortcut string (e.g. 'Ctrl+Shift+N', 'Ctrl+=', 'Ctrl+,', 'Esc')
 * into individual key labels.
 */
export function parseShortcutKeys(shortcut: string): string[] {
  const normalized = shortcut.replace(/CommandOrControl/gi, 'Ctrl')
  if (normalized.toLowerCase() === 'esc') return ['Esc']

  const keys: string[] = []
  let current = ''
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]
    // A '+' is a separator only if preceded by a key name and not at the end
    if (char === '+' && current.length > 0 && i < normalized.length - 1) {
      keys.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) keys.push(current)
  return keys
}

/**
 * Pattern matching shortcuts embedded in strings like "New Terminal (Ctrl+N)" or "Search (Ctrl+F)".
 */
const EMBEDDED_SHORTCUT_REGEX = /^(.*?)(?:\s+[-–—]\s+|\s+)\(((?:Ctrl|Shift|Alt|Cmd|CommandOrControl|Esc|F\d+)[A-Za-z0-9+,-/=]*)\)$/i

/**
 * Splits a label into the clean label text and its shortcut, whether provided explicitly
 * or parsed from the label string.
 */
export function extractTooltipLabelAndShortcut(
  content: React.ReactNode,
  explicitShortcut?: string,
): { label: React.ReactNode; shortcut?: string } {
  if (explicitShortcut) {
    return { label: content, shortcut: explicitShortcut }
  }

  if (typeof content === 'string') {
    const match = content.match(EMBEDDED_SHORTCUT_REGEX)
    if (match) {
      return {
        label: match[1].trim(),
        shortcut: match[2].trim(),
      }
    }
  }

  return { label: content, shortcut: undefined }
}
