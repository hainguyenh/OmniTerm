import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders `children` at the bottom of a tool window stripe. The stripe belongs to the IDE
 * workbench, which has no slot for it, so a host node is appended to the stripe element instead.
 * The stripe re-renders its own buttons but never removes foreign children, and the host is
 * re-attached if the stripe itself is rebuilt.
 */
export function StripePortal({ side, children }: { side: 'left' | 'right'; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const node = document.createElement('div')
    node.dataset.stripeBottom = side
    node.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 0'
    const attach = () => {
      const stripe = document.querySelector<HTMLElement>(`[data-stripe-side="${side}"]`)
      if (stripe && node.parentElement !== stripe) stripe.appendChild(node)
      return stripe !== null
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
  }, [side])
  return host ? createPortal(children, host) : null
}
