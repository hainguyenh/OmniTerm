import { Ellipsis, type LucideIcon } from 'lucide-react'
import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Tooltip } from './Tooltip'
import './workspace-file-tree.css'

interface WorkspaceRowAction {
  label: string
  icon: LucideIcon
  onSelect: (anchor: DOMRect) => void
  danger?: boolean
  active?: boolean
}

interface WorkspaceRowActionsProps {
  label: string
  items: WorkspaceRowAction[]
  children?: ReactNode
}

/** Lets a row open its `…` menu from a right-click, so both routes show the same grouped actions. */
export interface WorkspaceRowActionsHandle {
  /** Open at a pointer position, or under the `…` trigger when no position is given. */
  openAt: (x?: number, y?: number) => void
}

/** Only presentation state lives here; every command is supplied by the existing workspace flow. */
export const WorkspaceRowActions = forwardRef<WorkspaceRowActionsHandle, WorkspaceRowActionsProps>(
  function WorkspaceRowActions({ label, items, children }, ref) {
    const [open, setOpen] = useState(false)
    const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
    const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
    const triggerRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const id = useId()

    useImperativeHandle(ref, () => ({
      openAt: (x, y) => {
        setPointer(x === undefined || y === undefined ? null : { x, y })
        setOpen(true)
      },
    }), [])

    useLayoutEffect(() => {
      if (!open) return
      const place = () => {
        const anchor = pointer
          ? new DOMRect(pointer.x, pointer.y, 0, 0)
          : triggerRef.current?.getBoundingClientRect()
        const menu = menuRef.current
        if (!anchor || !menu) return
        const width = Math.min(248, window.innerWidth - 16)
        const height = Math.min(menu.scrollHeight, window.innerHeight - 16)
        const top = anchor.bottom + 4 + height <= window.innerHeight - 8
          ? anchor.bottom + 4
          : anchor.top - height - 4
        const left = pointer ? anchor.left : anchor.right - width
        setPosition({
          width,
          left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
          top: Math.max(8, top),
        })
      }
      place()
      window.addEventListener('resize', place)
      document.addEventListener('scroll', place, true)
      return () => {
        window.removeEventListener('resize', place)
        document.removeEventListener('scroll', place, true)
      }
    }, [open, pointer])

    useEffect(() => {
      if (open && position.visibility !== 'hidden') {
        menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
      }
    }, [open, position.visibility])

    useEffect(() => {
      if (!open) return
      const dismiss = (event: PointerEvent) => {
        if (event.target instanceof Node && !menuRef.current?.contains(event.target)
          && !triggerRef.current?.contains(event.target)) setOpen(false)
      }
      document.addEventListener('pointerdown', dismiss)
      return () => document.removeEventListener('pointerdown', dismiss)
    }, [open])

    const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const current = buttons.findIndex(button => button === document.activeElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
    }

    return (
      <>
        <Tooltip content={label} placement="bottom">
          <button
            ref={triggerRef}
            type="button"
            className="workspace-icon-button workspace-more-button"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            data-active={items.some(item => item.active) || undefined}
            onClick={event => {
              event.stopPropagation()
              setPointer(null)
              setOpen(value => !value)
            }}
            onDoubleClick={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                event.stopPropagation()
                setPointer(null)
                setOpen(true)
              }
            }}
          >
            <Ellipsis aria-hidden="true" />
          </button>
        </Tooltip>
        {open && createPortal(
          <div
            id={id}
            ref={menuRef}
            role="menu"
            aria-label={label}
            className="workspace-actions-menu"
            style={position}
            onKeyDown={navigate}
            onClick={event => {
              event.stopPropagation()
              setOpen(false)
            }}
            onDoubleClick={event => event.stopPropagation()}
            onContextMenu={event => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onBlur={event => {
              if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
                && !triggerRef.current?.contains(event.relatedTarget)) setOpen(false)
            }}
          >
            <div className="workspace-actions-heading">{label}</div>
            {children}
            {items.map(({ label: actionLabel, icon: Icon, onSelect, danger, active }) => (
              <button
                key={actionLabel}
                type="button"
                role="menuitem"
                data-tooltip-owned="true"
                className="workspace-menu-item"
                data-danger={danger || undefined}
                data-active={active || undefined}
                onClick={event => onSelect(event.currentTarget.getBoundingClientRect())}
              >
                <Icon aria-hidden="true" />
                <span>{actionLabel}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
      </>
    )
  },
)
