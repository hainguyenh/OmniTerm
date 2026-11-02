import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { DEFAULT_VIEW_GROUP_ID, groupUsedPaneCount, notifyCreateViewGroup, notifyMoveTabToGroup, type ViewGroup, type ViewGroupPatch } from '../viewGroups'
import { Tooltip } from './Tooltip'

const DesktopMonitorIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M3 6v15c0 1.1.9 2 2 2h22c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H5C3.9 4 3 4.9 3 6z" />
    <line x1="3" y1="19" x2="29" y2="19" />
    <line x1="9" y1="29" x2="23" y2="29" />
    <path d="M13 23c0 2.1-.7 4.6-1.8 6" />
    <path d="M20.8 29c-1.1-1.4-1.8-3.9-1.8-6" />
    <polyline points="7 9 10 12 7 15" />
    <line x1="13" y1="15" x2="17" y2="15" />
  </svg>
)

interface ViewGroupTabsProps {
  groups: ViewGroup[]
  activeGroupId: string
  totalTabCount?: number
  dragPane?: number | null
  panes?: (string | null)[]
  onSelect: (groupId: string) => void
  onUpdate: (groupId: string, patch: ViewGroupPatch) => void
  onReorder: (sourceId: string, targetId: string, before: boolean) => void
  onUngroup: (groupId: string) => void
  onMoveTab?: (tabId: string, groupId: string, sourcePaneIndex?: number) => void
  onCreateGroup?: () => void
}

const GROUP_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee']

export default function ViewGroupTabs({
  groups,
  activeGroupId,
  totalTabCount = 0,
  dragPane = null,
  panes,
  onSelect,
  onUpdate,
  onReorder,
  onUngroup,
  onMoveTab,
  onCreateGroup,
}: ViewGroupTabsProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; groupId: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropOverId, setDropOverId] = useState<string | null>(null)

  useEffect(() => {
    if (!menu && !editingId) return
    const closeMenu = () => {
      setMenu(null)
      setEditingId(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null)
        setEditingId(null)
      }
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [editingId, menu])

  const beginRename = (group: ViewGroup) => {
    setEditingId(group.id)
    setLabel(group.label)
  }

  const finishRename = (groupId: string, cancel = false) => {
    const next = label.trim()
    if (!cancel && next) onUpdate(groupId, { label: next })
    setEditingId(null)
  }

  const orderedGroups = [...groups].sort((a, b) => {
    if (a.id === DEFAULT_VIEW_GROUP_ID) return 1
    if (b.id === DEFAULT_VIEW_GROUP_ID) return -1
    return 0
  })

  return (
    <div className="relative flex flex-col items-center gap-1.5 w-full select-none" role="tablist" aria-label="Terminal desktops">
      {orderedGroups.map(group => {
        const selected = group.id === activeGroupId
        const isDefault = group.id === DEFAULT_VIEW_GROUP_ID
        const isDropTarget = dropOverId === group.id
        const tabTitle = isDefault ? `${group.label} · ${totalTabCount} tabs` : `${group.label} · ${groupUsedPaneCount(group)}/${group.layoutMode} panes`
        const desktopMatch = group.label.match(/^Desktop\s+(\d+)$/i)
        const displayLabel = desktopMatch ? `D${desktopMatch[1]}` : group.label
        const paneCount = `${groupUsedPaneCount(group)}/${group.layoutMode}`

        return (
          <Tooltip key={group.id} content={tabTitle} placement="right">
            <div
              role="tab"
              tabIndex={0}
              aria-label={tabTitle}
              aria-selected={selected}
              draggable={!isDefault}
              onClick={() => onSelect(group.id)}
              onContextMenu={event => {
                event.preventDefault()
                if (isDefault) return
                setEditingId(null)
                setMenu({ x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 200), groupId: group.id })
              }}
              onDragStart={event => {
                if (isDefault) return
                setDraggedId(group.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('application/x-omniterm-group', group.id)
                event.dataTransfer.setData('text/plain', group.id)
              }}
              onDragOver={event => {
                if (dragPane !== null || event.dataTransfer.types.includes('application/x-omniterm-pane') || event.dataTransfer.types.includes('application/x-omniterm-tab')) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropOverId(group.id)
                  return
                }
                if (!isDefault && draggedId && draggedId !== group.id) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropOverId(group.id)
                }
              }}
              onDragLeave={() => {
                if (dropOverId === group.id) setDropOverId(null)
              }}
              onDrop={event => {
                event.preventDefault()
                setDropOverId(null)
                const isPaneDrop = Boolean(dragPane !== null || (!draggedId && event.dataTransfer.types?.includes('application/x-omniterm-pane')))
                if (isPaneDrop) {
                  const paneIdxStr = event.dataTransfer.getData('application/x-omniterm-pane')
                  const paneIdx = dragPane !== null ? dragPane : (paneIdxStr ? parseInt(paneIdxStr, 10) : undefined)
                  const tabId = event.dataTransfer.getData('application/x-omniterm-tab') || (typeof paneIdx === 'number' && panes ? panes[paneIdx] : null)
                  if (tabId && group.id !== activeGroupId) {
                    if (onMoveTab) onMoveTab(tabId, group.id, paneIdx)
                    else notifyMoveTabToGroup(tabId, group.id, paneIdx)
                  }
                  setDraggedId(null)
                  return
                }
                if (isDefault) return
                const sourceId = draggedId ?? event.dataTransfer.getData('text/plain')
                if (sourceId && sourceId !== group.id) {
                  const rect = event.currentTarget.getBoundingClientRect()
                  const before = (rect.height && typeof event.clientY === 'number')
                    ? event.clientY < rect.top + rect.height / 2
                    : event.clientX < rect.left + rect.width / 2
                  onReorder(sourceId, group.id, before)
                }
                setDraggedId(null)
              }}
              onDragEnd={() => {
                setDraggedId(null)
                setDropOverId(null)
              }}
              onAuxClick={event => { if (event.button === 1 && !isDefault) onUngroup(group.id) }}
              onKeyDown={event => {
                if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
                const current = tabs.indexOf(event.currentTarget)
                const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                  : (current + (forward ? 1 : -1) + tabs.length) % tabs.length
                tabs[next]?.focus()
              }}
              className={`relative w-9 min-h-[36px] h-auto py-1 rounded-lg flex flex-col items-center justify-center transition-all cursor-pointer border-2 ${
                isDropTarget
                  ? 'border-dashed border-theme-accent bg-theme-hover ring-1 ring-theme-accent scale-105 text-theme-fg'
                  : selected
                    ? 'border-theme-accent text-theme-fg font-semibold'
                    : 'border-transparent text-theme-dim hover:text-theme-fg hover:bg-[var(--theme-hover-bg)]'
              } ${draggedId === group.id ? 'opacity-40' : ''}`}
              style={{
                backgroundColor: isDropTarget
                  ? 'var(--theme-hover-bg)'
                  : isDefault
                    ? '#6b728026'
                    : group.color
                      ? `${group.color}26`
                      : selected
                        ? 'var(--theme-hover-bg)'
                        : undefined,
                borderColor: isDropTarget
                  ? 'var(--theme-accent)'
                  : selected && group.color && !isDefault
                    ? group.color
                    : undefined,
              }}
            >
              {!selected && group.color && !isDefault && (
                <div
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
              )}
              {isDefault ? (
                <div className="flex flex-col items-center justify-center leading-none">
                  <DesktopMonitorIcon className="w-3.5 h-3.5" />
                  <span className="sr-only">Ungrouped</span>
                  <span className="font-mono text-[8px] opacity-75 mt-0.5">{totalTabCount}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center leading-none gap-1.5">
                  <span
                    className="font-bold text-[10px] font-mono tracking-tight select-none max-h-20 overflow-hidden text-ellipsis"
                    style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    title={group.label}
                  >
                    {displayLabel}
                  </span>
                  <span className="font-mono text-[8px] opacity-75">{paneCount}</span>
                </div>
              )}
            </div>
          </Tooltip>
        )
      })}
      <Tooltip content="New Desktop" placement="right">
        <button
          type="button"
          aria-label="New Desktop"
          data-testid="add-view-group"
          onClick={() => {
            if (onCreateGroup) onCreateGroup()
            else notifyCreateViewGroup()
          }}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-theme-dim hover:text-theme-fg hover:bg-[var(--theme-hover-bg)] border border-dashed border-theme-border/60 hover:border-theme-accent transition-all cursor-pointer mt-0.5 flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </Tooltip>
      {menu && (() => {
        const group = groups.find(item => item.id === menu.groupId)
        if (!group || group.id === DEFAULT_VIEW_GROUP_ID) return null
        return (
          <div className="fixed z-50 w-44 rounded-lg border border-theme-border bg-theme-popup p-1.5 shadow-xl" style={{ left: menu.x, top: menu.y }} onMouseDown={event => event.stopPropagation()} role="menu" aria-label={`${group.label} options`}>
            {editingId === group.id ? (
              <div className="space-y-1.5 px-1 py-1" role="group" aria-label="Rename group">
                <label htmlFor={`group-name-${group.id}`} className="block text-[10px] text-theme-dim">Group name</label>
                <input
                  id={`group-name-${group.id}`}
                  aria-label="Group name"
                  autoFocus
                  value={label}
                  onChange={event => setLabel(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); finishRename(group.id) }
                    if (event.key === 'Escape') { event.preventDefault(); finishRename(group.id, true) }
                  }}
                  className="w-full rounded border border-theme-accent bg-theme-bg px-1.5 py-1 text-xs text-theme-fg outline-none"
                />
                <button type="button" className="w-full rounded px-2 py-1 text-left text-[11px] text-theme-dim hover:bg-theme-hover hover:text-theme-fg" onClick={() => finishRename(group.id, true)}>Cancel</button>
              </div>
            ) : (
              <>
                <button type="button" role="menuitem" className="w-full rounded px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover" onClick={() => beginRename(group)}>Rename group</button>
                <button type="button" role="menuitem" className="w-full rounded px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover" onClick={() => { setMenu(null); if (onCreateGroup) onCreateGroup(); else notifyCreateViewGroup(); }}>New desktop</button>
              </>
            )}
            {group.id !== DEFAULT_VIEW_GROUP_ID && <button type="button" role="menuitem" className="w-full rounded px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover" onClick={() => onUngroup(group.id)}>Ungroup</button>}
            <div className="px-2 pt-2 text-[10px] text-theme-dim">Group color</div>
            <div className="flex gap-1 px-2 py-1.5" role="group" aria-label="Group color">
              {GROUP_COLORS.map(color => (
                <Tooltip key={color} content={`Set color ${color}`} placement="top">
                  <button type="button" aria-label={`Set color ${color}`} className="h-5 w-5 rounded-full border border-white/30" style={{ backgroundColor: color }} onClick={() => onUpdate(group.id, { color })} />
                </Tooltip>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
