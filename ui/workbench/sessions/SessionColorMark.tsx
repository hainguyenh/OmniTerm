import { cycleSessionColor, identityFor, useSessionColors } from './sessionColors'

/**
 * The session's colour and shape marker. It is the same in the editor tab and in the Sessions tool
 * window; clicking it picks the next colour for both. The shape carries the identity too, so it
 * does not rest on colour alone.
 */
export function SessionColorMark({ sessionId, className }: { sessionId: string; className?: string }) {
  const index = useSessionColors((state) => state.byId[sessionId])
  if (index === undefined) return null
  const identity = identityFor(index)
  const Icon = identity.icon
  return (
    <span
      role="button"
      tabIndex={0}
      className={className}
      data-session-color={identity.color}
      aria-label={`Session colour: ${identity.label}. Click to change`}
      title={`${identity.label} - click to change the colour`}
      onClick={(event) => {
        event.stopPropagation()
        cycleSessionColor(sessionId)
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        cycleSessionColor(sessionId)
      }}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: identity.color, cursor: 'pointer' }}
    >
      <Icon width={11} height={11} fill={identity.color} aria-hidden="true" />
    </span>
  )
}
