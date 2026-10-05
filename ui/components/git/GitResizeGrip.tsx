import type React from 'react'

import './git-resize.css'

interface GitResizeGripProps {
  label: string
  /** The panel corner the grip sits in; a bottom-anchored panel grows upward from its top. */
  corner: 'bottom-right' | 'top-right'
  onResizeStart: (event: React.MouseEvent<HTMLElement>) => void
  onResizeKey: (event: React.KeyboardEvent<HTMLElement>) => void
  onReset: () => void
}

/** Drag handle for a resizable Git panel; double-click or Home restores the default size. */
export function GitResizeGrip({ label, corner, onResizeStart, onResizeKey, onReset }: GitResizeGripProps) {
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      title={`${label} — drag to resize, double-click to reset`}
      className={`git-resize-grip is-${corner}`}
      onMouseDown={onResizeStart}
      onKeyDown={onResizeKey}
      onDoubleClick={onReset}
    />
  )
}
