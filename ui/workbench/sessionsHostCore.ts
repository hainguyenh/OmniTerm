import { createContext, useEffect, useRef, useState } from 'react'

import type { EditorInput } from '../ide/workbench/contributions'

/** Editor tab kind that shows the OmniTerm sessions next to files. */
export const SESSIONS_KIND = 'omniterm-sessions'
export const SESSIONS_INPUT: EditorInput = { kind: SESSIONS_KIND, key: SESSIONS_KIND }

/**
 * The sessions live in one DOM node that React renders into a portal and that is moved between
 * places (the plain window, or the workbench's Sessions tab). Moving the node keeps every terminal
 * mounted: re-rendering the same children under a different parent would dispose their xterm
 * instances and drop the scrollback.
 */
export function createSessionsHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.className = 'h-full w-full min-h-0 min-w-0'
  host.dataset.sessionsHost = ''
  return host
}

export const SessionsHostContext = createContext<HTMLElement | null>(null)

/** Puts `host` inside the element this hook's ref is attached to, for as long as it is mounted. */
export function useAttachHost<T extends HTMLElement>(host: HTMLElement | null) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const container = ref.current
    if (!container || !host) return undefined
    container.appendChild(host)
    return () => {
      if (host.parentElement === container) container.removeChild(host)
    }
  }, [host])
  return ref
}

/** A host node that lives as long as the component that calls this. */
export function useSessionsHost(): HTMLDivElement {
  const [host] = useState(createSessionsHost)
  return host
}
