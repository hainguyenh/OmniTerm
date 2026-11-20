import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Where on the stripe: above its first button (Notifications on the right), or low, after the spacer. */
export type StripePlacement = 'top' | 'bottom'

/**
 * Renders `children` on a tool window stripe, at the top (above its first group of buttons) or at
 * the bottom (right above its bottom group). The stripe belongs to the IDE workbench, which has no
 * slot for it, so a host node is placed among the stripe's children instead. The stripe re-renders
 * its own buttons but never removes foreign children, and the host is put back if it moves.
 */
export function StripePortal({ side, at = 'bottom', children }: { side: 'left' | 'right'; at?: StripePlacement; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const node = document.createElement('div')
    if (at === 'top') node.dataset.stripeTop = side
    else node.dataset.stripeBottom = side
    // The host adds no box of its own: its buttons join the stripe's flex column and keep the
    // stripe's own gap. A padded host spaced the layout picker further from Notifications than
    // any two stripe buttons, and an empty one still took room.
    node.style.display = 'contents'
    const attach = () => {
      const stripe = document.querySelector<HTMLElement>(`[data-stripe-side="${side}"]`)
      if (!stripe) return false
      if (at === 'top') {
        if (stripe.firstChild !== node) stripe.insertBefore(node, stripe.firstChild)
        return true
      }
      const spacer = stripe.querySelector<HTMLElement>(':scope > [data-stripe-spacer]')
      if (node.parentElement !== stripe || (spacer && node.previousSibling !== spacer)) stripe.insertBefore(node, spacer?.nextSibling ?? null)
      return true
    }
    attach()
    setHost(node)
    const observer = new MutationObserver(attach)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      node.remove()
      setHost(null)
    }
  }, [side, at])
  return host ? createPortal(children, host) : null
}
