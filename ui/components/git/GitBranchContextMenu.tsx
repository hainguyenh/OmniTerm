import { X } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { placeMenu, type MenuPoint } from './gitMenuPlacement'

interface GitBranchContextMenuProps {
  title: string
  point: MenuPoint
  /** The positioned element the menu's backdrop fills; placement is relative to it. */
  containerRef: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
}

/**
 * The branch actions menu, opened where the user right-clicked. It lives inside the branches dialog
 * (not a body portal) so the dialog's focus trap and Escape handling keep covering it — and because
 * the dialog is a size container, `position: fixed` would resolve against the dialog anyway.
 */
export function GitBranchContextMenu({ title, point, containerRef, onClose, children }: GitBranchContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current?.getBoundingClientRect()
    const menu = menuRef.current
    if (!container || !menu) return
    setPosition(placeMenu(point, container, { width: menu.offsetWidth, height: menu.offsetHeight }))
  }, [point, containerRef])

  return (
    <div
      className="git-branch-context-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      onContextMenu={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        className="git-branch-context"
        role="dialog"
        aria-modal="true"
        aria-label={`Actions for ${title}`}
        style={position ?? { visibility: 'hidden' }}
      >
        <div className="git-branch-context-heading">
          <strong>{title}</strong>
          <button type="button" autoFocus className="git-icon-button" aria-label="Close branch actions" onClick={onClose}><X /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
