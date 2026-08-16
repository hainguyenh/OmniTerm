import React from 'react'
import { parseShortcutKeys } from '../utils/shortcutFormatting'

interface KeycapProps {
  keyName: string
}

/**
 * A retro mechanical keycap component that adapts its appearance to the active theme
 * while maintaining strict uniform physical dimensions.
 */
export const Keycap: React.FC<KeycapProps> = ({ keyName }) => {
  return (
    <kbd
      data-testid="keycap"
      className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 text-[9px] font-mono font-bold uppercase tracking-wider rounded-[3px] border border-b-2 border-[var(--theme-border)] bg-[var(--theme-sidebar)] text-[var(--theme-fg)] select-none"
      style={{
        boxShadow: '0 1px 0 0 rgba(0, 0, 0, 0.4), inset 0 1px 0 0 rgba(255, 255, 255, 0.15)',
        textShadow: '0 1px 1px rgba(0, 0, 0, 0.3)',
      }}
    >
      {keyName}
    </kbd>
  )
}

interface KeycapComboProps {
  shortcut: string
}

/**
 * Renders a full shortcut key combo (e.g. Ctrl + Shift + N) using retro styled keycaps.
 */
export const KeycapCombo: React.FC<KeycapComboProps> = ({ shortcut }) => {
  const keys = parseShortcutKeys(shortcut)
  return (
    <span data-testid="keycap-combo" className="inline-flex items-center gap-1">
      {keys.map((k, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && (
            <span className="text-[9px] text-[var(--theme-dim)] opacity-60 font-sans font-normal">
              +
            </span>
          )}
          <Keycap keyName={k} />
        </React.Fragment>
      ))}
    </span>
  )
}
