import { useSessionBridge } from './sessionBridge'

const LABEL = { connecting: 'Connecting', busy: 'Running', connected: 'Idle', closed: 'Exited', error: 'Exited' } as const

/** The tab's trailing marker: connecting, busy (a foreground process runs) or exited. */
export function SessionTabStatus({ sessionId }: { sessionId: string }) {
  const state = useSessionBridge((bridge) => {
    const session = bridge.sessions.find((item) => item.id === sessionId)
    if (!session) return null
    if (session.status === 'connected') return session.busy ? 'busy' : 'connected'
    return session.status
  })
  if (!state || state === 'connected') return null
  const color = state === 'busy' ? '#e5a50a' : state === 'connecting' ? '#3584e4' : '#8a8a8a'
  return (
    <span
      role="img"
      aria-label={LABEL[state]}
      title={LABEL[state]}
      data-session-status={state}
      style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color }}
    />
  )
}
