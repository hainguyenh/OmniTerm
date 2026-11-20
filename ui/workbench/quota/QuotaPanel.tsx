import type { QuotaDock } from '../../features/agent-quota/quotaDock'
import { Icon } from '../../ide/ui'
import { SESSIONS_ICON } from '../shellIcons'
import { useSessionBridge } from '../sessions/sessionBridge'

import { setQuotaDock, useQuotaDock } from './quotaDockState'
import { DOCK_ICONS } from './quotaIcons'
import type { QuotaAgentGroup } from './quotaModel'
import { useQuotaGroups } from './useQuotaGroups'
import './quotaWorkbench.css'

function ActiveSessionLine({ sessionId, agent, profile }: { sessionId: string | null; agent?: string; profile?: string }) {
  const title = useSessionBridge((state) => state.sessions.find((item) => item.id === sessionId)?.name ?? sessionId)
  if (!agent || !profile)
    return (
      <div className="omt-q-sess">
        <span className="omt-q-muted">Active tab is not an agent session. Showing the default profile of each agent.</span>
      </div>
    )
  return (
    <div className="omt-q-sess">
      <Icon name={SESSIONS_ICON} size={16} />
      <span>
        Active session <b>{title}</b> · {agent} / profile <b>{profile}</b>
      </span>
    </div>
  )
}

function AgentGroup({ group }: { group: QuotaAgentGroup }) {
  const count = group.profiles.length
  return (
    <div className="omt-q-grp" data-active={group.active || undefined} data-testid={`quota-group-${group.agent}`}>
      <div className="omt-q-grp-head">
        <b>{group.name}</b>
        {group.active && <span className="omt-q-pill">active session</span>}
        <span className="omt-q-subtle">{`${count} profile${count === 1 ? '' : 's'}`}</span>
      </div>
      {group.profiles.map((row) => {
        const marked = group.active && row.active
        return (
          <div key={row.key} title={row.detail}>
            <div className="omt-q-prof" data-active={marked || undefined}>
              <span className="omt-q-prof-name">{`${marked ? '● ' : ''}${row.name}`}</span>
              <div className="omt-q-progress">
                <i style={{ width: `${row.pct ?? 0}%` }} />
              </div>
              <span className="omt-q-prof-pct">{row.pct === null ? '–' : `${row.pct}%`}</span>
            </div>
            <div className="omt-q-prof-detail">{row.detail}</div>
          </div>
        )
      })}
    </div>
  )
}

/** Values for the active session, then every agent with all its profiles (the mock's quota panel). */
export function QuotaBody() {
  const { sessionId, active, groups } = useQuotaGroups()
  const activeGroup = groups.find((group) => group.active)
  return (
    <div className="omt-q-body" data-testid="quota-body">
      <ActiveSessionLine sessionId={sessionId} agent={activeGroup?.name} profile={active?.profileName} />
      {groups.length === 0 && <div className="omt-q-empty">No agent profile has been seen yet. Start an agent in a terminal.</div>}
      {groups.map((group) => (
        <AgentGroup key={group.agent} group={group} />
      ))}
    </div>
  )
}

const DOCKS: ReadonlyArray<{ dock: QuotaDock; icon: string; label: string }> = [
  { dock: 'left', icon: DOCK_ICONS.left, label: 'left tool window' },
  { dock: 'right', icon: DOCK_ICONS.right, label: 'right tool window' },
  { dock: 'stripL', icon: DOCK_ICONS.stripL, label: 'left tab strip as quota rings' },
  { dock: 'stripR', icon: DOCK_ICONS.stripR, label: 'right tab strip as quota rings' },
  { dock: 'footer', icon: DOCK_ICONS.footer, label: 'footer status line' },
]

/** "Move quota to": left / right tool window, left / right tab strip line, footer. */
export function QuotaDockButtons() {
  const current = useQuotaDock()
  return (
    <span className="omt-q-dock">
      {DOCKS.map(({ dock, icon, label }) => (
        <button
          key={dock}
          type="button"
          title={`Move quota to: ${label}`}
          aria-label={`Move quota to: ${label}`}
          aria-pressed={current === dock || (dock === 'right' && current === 'both')}
          onClick={() => setQuotaDock(dock)}
        >
          <Icon name={icon} size={16} />
        </button>
      ))}
    </span>
  )
}

/** The Agent quota tool window's body. */
export function QuotaToolWindow() {
  return <QuotaBody />
}
