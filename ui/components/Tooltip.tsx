import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { extractTooltipLabelAndShortcut } from '../utils/shortcutFormatting'
import { KeycapCombo } from './Keycap'

export type TooltipPlacement = 'bottom' | 'top' | 'left' | 'right'

export interface TooltipProps {
  /** Text or React content to display inside the tooltip. When omitted or empty, tooltip is disabled. */
  content?: React.ReactNode
  /** Optional keyboard shortcut combo, e.g. 'Ctrl+N' or 'Ctrl+Shift+N'. */
  shortcut?: string
  /** Initial preferred placement. Defaults to 'bottom'. */
  placement?: TooltipPlacement
  /** Delay in milliseconds before showing the tooltip on hover. Defaults to 150ms. */
  delay?: number
  /** Additional class names applied to the tooltip popup. */
  className?: string
  /** Trigger element that owns the tooltip. */
  children: React.ReactElement
}

interface Position {
  top: number
  left: number
  resolvedPlacement: TooltipPlacement
}

const VIEWPORT_PADDING = 8
const OFFSET = 6

/**
 * Calculates the best viewport-safe position for a tooltip.
 * Default placement is below ('bottom'), but flips to 'top', 'right', or 'left'
 * and clamps horizontally/vertically so it remains fully visible.
 */
function calculatePosition(
  anchorRect: DOMRect,
  tooltipRect: DOMRect,
  preferred: TooltipPlacement,
): Position {
  const vWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vHeight = typeof window !== 'undefined' ? window.innerHeight : 768

  let placement = preferred
  let top = 0
  let left = 0

  // 1. Determine vertical placement (defaulting to bottom, flipping to top if colliding)
  if (preferred === 'bottom' || preferred === 'top') {
    if (preferred === 'bottom') {
      const bottomSpace = vHeight - anchorRect.bottom - OFFSET
      if (bottomSpace < tooltipRect.height + VIEWPORT_PADDING && anchorRect.top > tooltipRect.height + VIEWPORT_PADDING) {
        placement = 'top'
      }
    } else if (preferred === 'top') {
      const topSpace = anchorRect.top - OFFSET
      if (topSpace < tooltipRect.height + VIEWPORT_PADDING && vHeight - anchorRect.bottom > tooltipRect.height + VIEWPORT_PADDING) {
        placement = 'bottom'
      }
    }

    if (placement === 'bottom') {
      top = anchorRect.bottom + OFFSET
    } else {
      top = anchorRect.top - tooltipRect.height - OFFSET
    }

    // Center horizontally on anchor
    left = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2
  } else {
    // 2. Horizontal placements (left / right)
    if (preferred === 'right') {
      const rightSpace = vWidth - anchorRect.right - OFFSET
      if (rightSpace < tooltipRect.width + VIEWPORT_PADDING && anchorRect.left > tooltipRect.width + VIEWPORT_PADDING) {
        placement = 'left'
      }
    } else if (preferred === 'left') {
      const leftSpace = anchorRect.left - OFFSET
      if (leftSpace < tooltipRect.width + VIEWPORT_PADDING && vWidth - anchorRect.right > tooltipRect.width + VIEWPORT_PADDING) {
        placement = 'right'
      }
    }

    if (placement === 'right') {
      left = anchorRect.right + OFFSET
    } else {
      left = anchorRect.left - tooltipRect.width - OFFSET
    }

    // Center vertically on anchor
    top = anchorRect.top + (anchorRect.height - tooltipRect.height) / 2
  }

  // 3. Clamp inside viewport bounds
  left = Math.max(VIEWPORT_PADDING, Math.min(left, vWidth - tooltipRect.width - VIEWPORT_PADDING))
  top = Math.max(VIEWPORT_PADDING, Math.min(top, vHeight - tooltipRect.height - VIEWPORT_PADDING))

  return { top, left, resolvedPlacement: placement }
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  shortcut,
  placement = 'bottom',
  delay = 150,
  className = '',
  children,
}) => {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const show = useCallback(() => {
    if (!content) return
    clearTimer()
    if (delay > 0) {
      timerRef.current = setTimeout(() => {
        setVisible(true)
      }, delay)
    } else {
      setVisible(true)
    }
  }, [clearTimer, content, delay])

  const hide = useCallback(() => {
    clearTimer()
    setVisible(false)
    setCoords(null)
  }, [clearTimer])

  // Update coordinates when visible
  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return
    const anchorRect = triggerRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const pos = calculatePosition(anchorRect, tooltipRect, placement)
    setCoords(pos)
  }, [placement])

  useLayoutEffect(() => {
    if (visible) {
      updatePosition()
    }
  }, [visible, updatePosition])

  useEffect(() => {
    if (!visible) return
    const handleScrollOrResize = () => updatePosition()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('resize', handleScrollOrResize, { passive: true })
    window.addEventListener('scroll', handleScrollOrResize, { passive: true, capture: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', handleScrollOrResize)
      window.removeEventListener('scroll', handleScrollOrResize, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [visible, updatePosition, hide])

  useEffect(() => () => clearTimer(), [clearTimer])

  if (!content) {
    return children
  }

  // Clone trigger element with ref and event handlers
  const triggerProps = {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
      const originalRef = (children as unknown as { ref?: React.Ref<HTMLElement> }).ref
      if (typeof originalRef === 'function') {
        originalRef(node)
      } else if (originalRef && typeof originalRef === 'object') {
        ;(originalRef as React.MutableRefObject<HTMLElement | null>).current = node
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e)
      show()
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e)
      hide()
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e)
      show()
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e)
      hide()
    },
    onClick: (e: React.MouseEvent) => {
      children.props.onClick?.(e)
      hide()
    },
  }

  const clonedTrigger = React.cloneElement(children, triggerProps)

  const { label, shortcut: resolvedShortcut } = extractTooltipLabelAndShortcut(content, shortcut)

  const renderedContent = resolvedShortcut ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span>{label}</span>
      <span className="text-[var(--theme-dim)] opacity-60 font-mono">-</span>
      <KeycapCombo shortcut={resolvedShortcut} />
    </span>
  ) : (
    content
  )

  const portalContent = visible && typeof document !== 'undefined' ? (
    createPortal(
      <div
        ref={tooltipRef}
        role="tooltip"
        aria-hidden={!visible}
        className={`pointer-events-none fixed z-[9999] rounded-md border border-theme-border bg-theme-popup px-2 py-1 text-[11px] font-medium text-theme-fg shadow-xl whitespace-nowrap transition-opacity duration-150 ${className}`}
        style={{
          top: coords ? `${coords.top}px` : '-9999px',
          left: coords ? `${coords.left}px` : '-9999px',
          opacity: coords ? 1 : 0,
        }}
      >
        {renderedContent}
      </div>,
      document.body,
    )
  ) : null

  return (
    <>
      {clonedTrigger}
      {portalContent}
    </>
  )
}
