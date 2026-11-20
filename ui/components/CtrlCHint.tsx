import { useEffect, useState } from 'react'

const HINT_VISIBLE_MS = 1500

interface CtrlCHintProps {
  /** Bumped each time a lone Ctrl+C reached the process; every bump shows the hint again. */
  trigger: number
}

/** Brief, non-blocking reminder that pressing Ctrl+C a second time closes the session. */
export default function CtrlCHint({ trigger }: CtrlCHintProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (trigger === 0) return undefined
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), HINT_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [trigger])

  if (!visible) return null
  return (
    <div
      role="status"
      data-ctrlc-hint
      className="pointer-events-none absolute bottom-2 right-3 z-10 rounded-md border border-theme-border bg-theme-sidebar px-2 py-1 text-xs text-theme-dim shadow-md"
    >
      Press Ctrl+C again to close the session
    </div>
  )
}
