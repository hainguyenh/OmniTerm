import { HighlightedText, Icon, IconButton, type TreeRowState } from '../../ide/ui'

import { connectionRowActions } from './connectionActions'
import { nodeDetail, nodeIcon, nodeLabel, type ConnectionNode } from './connectionNodes'

/** The Tree row class the hover actions key off: they show while the whole row is hovered. */
export const CONNECTION_ROW_CLASS = 'group/connection'

/**
 * A Connections row: icon, name and address, then the row's actions (Connect, Edit, Delete; or
 * Show Terminal and Save for an `ssh` typed in a terminal) as buttons shown while it is hovered or
 * holds focus, so a connection can be used without its right-click menu.
 */
export function ConnectionRow({ node, state, workspaceId }: {
  node: ConnectionNode
  state: TreeRowState
  workspaceId: string | null
}) {
  const detail = nodeDetail(node)
  const actions = connectionRowActions(node, workspaceId)
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <Icon name={nodeIcon(node)} size={16} className="mr-0.5 flex-none text-[var(--fg-muted)]" />
      <HighlightedText className="min-w-0 truncate" text={nodeLabel(node)} indices={state.matches} tone="accent" />
      {detail && <span className="ml-1 min-w-0 truncate text-[var(--fg-muted)]">{detail}</span>}
      {actions.length > 0 && (
        <span
          className="invisible ml-auto flex flex-none items-center group-focus-within/connection:visible group-hover/connection:visible"
          data-testid="connection-row-actions"
        >
          {actions.map((action) => (
            <IconButton
              key={action.id}
              icon={action.icon}
              title={action.label}
              size="small"
              tone={action.danger ? 'danger' : 'default'}
              // The row connects on double-click: a quick second click on a button is not that.
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                action.run()
              }}
            />
          ))}
        </span>
      )}
    </span>
  )
}
