import { useEffect, useState } from 'react'
import { DEFAULT_VIEW_GROUP_ID, groupUsedPaneCount, type ViewGroup, type ViewGroupPatch } from '../viewGroups'

interface ViewGroupTabsProps {
  groups: ViewGroup[]
  activeGroupId: string
  totalTabCount?: number
  onSelect: (groupId: string) => void
  onUpdate: (groupId: string, patch: ViewGroupPatch) => void
  onReorder: (sourceId: string, targetId: string, before: boolean) => void
  onUngroup: (groupId: string) => void
}

const GROUP_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee']

export default function ViewGroupTabs({ groups, activeGroupId, totalTabCount = 0, onSelect, onUpdate, onReorder, onUngroup }: ViewGroupTabsProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; groupId: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [draggedId, setDraggedId] = useState<string | null>(null)

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
    <div className="relative flex items-center gap-1 overflow-x-auto no-scrollbar px-2.5 py-1 border-b border-theme-border/60" role="tablist" aria-label="Terminal views">
      {orderedGroups.map(group => {
        const selected = group.id === activeGroupId
        const isDefault = group.id === DEFAULT_VIEW_GROUP_ID
        return (
          <div
            key={group.id}
            role="tab"
            tabIndex={0}
            aria-selected={selected}
            draggable={!isDefault}
            onClick={() => onSelect(group.id)}
            onContextMenu={event => {
              event.preventDefault()
              if (isDefault) return
              setEditingId(null)
              setMenu({ x: event.clientX, y: event.clientY, groupId: group.id })
            }}
            onDragStart={event => {
              if (isDefault) return
              setDraggedId(group.id)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', group.id)
            }}
            onDragOver={event => {
              if (!isDefault && draggedId && draggedId !== group.id) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }
            }}
            onDrop={event => {
              if (isDefault) return
              event.preventDefault()
              const sourceId = draggedId ?? event.dataTransfer.getData('text/plain')
              if (sourceId && sourceId !== group.id) {
                const rect = event.currentTarget.getBoundingClientRect()
                onReorder(sourceId, group.id, event.clientX < rect.left + rect.width / 2)
              }
              setDraggedId(null)
            }}
            onDragEnd={() => setDraggedId(null)}
            onAuxClick={event => { if (event.button === 1 && !isDefault) onUngroup(group.id) }}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
              const current = tabs.indexOf(event.currentTarget)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
              tabs[next]?.focus()
            }}
            className={`inline-flex min-w-[112px] items-center justify-between gap-2 rounded-md border px-2 py-1 text-[10px] transition-colors ${isDefault ? 'cursor-default border-transparent text-theme-dim' : selected ? 'border-theme-accent text-theme-fg' : 'border-transparent text-theme-dim hover:border-theme-border hover:text-theme-fg'} ${draggedId === group.id ? 'opacity-50' : ''}`}
            style={{ backgroundColor: isDefault ? '#6b728026' : group.color ? `${group.color}26` : selected ? 'var(--theme-hover-bg)' : undefined, borderColor: selected && group.color && !isDefault ? group.color : undefined }}
            title={isDefault ? `${group.label} · ${totalTabCount} tabs` : `${group.label} · ${groupUsedPaneCount(group)}/${group.layoutMode} panes`}
          >
            <span className="truncate">{group.label}</span>
            <span className="font-mono text-[9px] opacity-70">{isDefault ? totalTabCount : `${groupUsedPaneCount(group)}/${group.layoutMode}`}</span>
          </div>
        )
      })}
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
              <button type="button" role="menuitem" className="w-full rounded px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover" onClick={() => beginRename(group)}>Rename group</button>
            )}
            {group.id !== DEFAULT_VIEW_GROUP_ID && <button type="button" role="menuitem" className="w-full rounded px-2 py-1.5 text-left text-xs text-theme-fg hover:bg-theme-hover" onClick={() => onUngroup(group.id)}>Ungroup</button>}
            <div className="px-2 pt-2 text-[10px] text-theme-dim">Group color</div>
            <div className="flex gap-1 px-2 py-1.5" role="group" aria-label="Group color">
              {GROUP_COLORS.map(color => (
                <button key={color} type="button" title={`Set color ${color}`} aria-label={`Set group color ${color}`} className="h-5 w-5 rounded-full border border-white/30" style={{ backgroundColor: color }} onClick={() => onUpdate(group.id, { color })} />
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
