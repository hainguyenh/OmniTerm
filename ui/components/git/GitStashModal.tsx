import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, Check, Loader2, Plus, Trash2, Undo2, X } from 'lucide-react'
import { createGitAPI } from '../../gitAPI'
import type { GitStashEntry } from './gitTypes'

interface GitStashModalProps {
  cwd: string
  onClose: () => void
  onRefresh?: () => void
}

export const GitStashModal: React.FC<GitStashModalProps> = ({ cwd, onClose, onRefresh }) => {
  const [stashes, setStashes] = useState<GitStashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [keepIndex, setKeepIndex] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const api = createGitAPI()

  const loadStashes = async () => {
    setLoading(true)
    try {
      const list = await api.getStashes(cwd)
      setStashes(list)
    } catch (err) {
      setNotice(`Failed to load stashes: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStashes()
  }, [cwd])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSaveStash = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionLoading('Saving stash...')
    setNotice(null)
    try {
      const res = await api.saveStash(cwd, message.trim() || undefined, keepIndex)
      setMessage('')
      setNotice(res || 'Changes stashed successfully')
      await loadStashes()
      onRefresh?.()
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    } catch (err) {
      setNotice(`Stash failed: ${String(err)}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handlePop = async (index: number) => {
    setActionLoading(`Popping stash@{${index}}...`)
    try {
      const res = await api.popStash(cwd, index)
      setNotice(res || `Stash@{${index}} popped`)
      await loadStashes()
      onRefresh?.()
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    } catch (err) {
      setNotice(`Pop failed: ${String(err)}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleApply = async (index: number) => {
    setActionLoading(`Applying stash@{${index}}...`)
    try {
      const res = await api.applyStash(cwd, index)
      setNotice(res || `Stash@{${index}} applied`)
      onRefresh?.()
      window.dispatchEvent(new CustomEvent('omniterm:git-refresh'))
    } catch (err) {
      setNotice(`Apply failed: ${String(err)}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDrop = async (index: number) => {
    if (!window.confirm(`Are you sure you want to drop stash@{${index}}?`)) return
    setActionLoading(`Dropping stash@{${index}}...`)
    try {
      await api.dropStash(cwd, index)
      setNotice(`Stash@{${index}} dropped`)
      await loadStashes()
    } catch (err) {
      setNotice(`Drop failed: ${String(err)}`)
    } finally {
      setActionLoading(null)
    }
  }

  const content = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Git Stash Manager"
    >
      <div className="git-menu w-full max-w-lg bg-theme-bg border border-theme-border rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-theme-fg animate-in zoom-in-95 duration-150 max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme-border bg-theme-sidebar flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Archive className="w-4 h-4 text-theme-accent flex-shrink-0" />
            <span className="font-semibold text-theme-fg truncate">
              Git Stashes ({stashes.length})
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="p-1 rounded hover:bg-theme-hover hover:text-theme-fg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notice bar */}
        {notice && (
          <div className="px-3 py-1.5 text-[11px] bg-theme-accent/10 border-b border-theme-accent/30 text-theme-accent truncate">
            {notice}
          </div>
        )}

        {/* Stash creation form */}
        <form onSubmit={handleSaveStash} className="p-3 border-b border-theme-border bg-theme-sidebar/40 flex flex-col gap-2">
          <div className="text-[11px] font-semibold text-theme-dim flex items-center gap-1">
            <Plus className="w-3.5 h-3.5 text-theme-accent" />
            <span>Stash Current Changes</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional stash message..."
              className="flex-1 bg-theme-bg border border-theme-border rounded px-2.5 py-1 text-xs text-theme-fg placeholder-theme-dim outline-none focus:border-theme-accent"
            />
            <button
              type="submit"
              disabled={Boolean(actionLoading)}
              className="px-3 py-1 bg-theme-accent hover:opacity-90 disabled:opacity-40 text-white rounded text-xs font-medium transition-opacity cursor-pointer flex items-center gap-1"
            >
              {actionLoading?.startsWith('Saving') ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Archive className="w-3.5 h-3.5" />
              )}
              <span>Stash</span>
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-theme-dim cursor-pointer select-none">
            <input
              type="checkbox"
              checked={keepIndex}
              onChange={(e) => setKeepIndex(e.target.checked)}
              className="rounded border-theme-border text-theme-accent cursor-pointer"
            />
            <span>Keep staged changes intact (--keep-index)</span>
          </label>
        </form>

        {/* Stash list */}
        <div className="flex-1 overflow-y-auto py-1 min-h-[160px] custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center p-8 gap-2 text-theme-dim">
              <Loader2 className="w-4 h-4 animate-spin text-theme-accent" />
              <span>Loading stashes...</span>
            </div>
          ) : stashes.length === 0 ? (
            <div className="p-8 text-center text-theme-dim">
              No stashes saved in this repository
            </div>
          ) : (
            <div className="divide-y divide-theme-border/40">
              {stashes.map((s) => (
                <div
                  key={s.index}
                  className="px-3 py-2 flex items-center justify-between hover:bg-theme-hover/60 transition-colors gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-semibold text-theme-accent">
                        {s.name}
                      </span>
                      {s.timestamp && (
                        <span className="text-[10px] text-theme-dim">· {s.timestamp}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-theme-fg truncate font-mono mt-0.5">
                      {s.message}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePop(s.index)}
                      disabled={Boolean(actionLoading)}
                      title="Pop stash (apply and remove from list)"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-theme-border hover:border-theme-accent text-theme-fg text-[11px] transition-colors cursor-pointer"
                    >
                      <Undo2 className="w-3 h-3 text-cyan-400" />
                      <span>Pop</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApply(s.index)}
                      disabled={Boolean(actionLoading)}
                      title="Apply stash (keep in list)"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-theme-border hover:border-theme-accent text-theme-fg text-[11px] transition-colors cursor-pointer"
                    >
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Apply</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDrop(s.index)}
                      disabled={Boolean(actionLoading)}
                      title="Drop stash (permanently delete)"
                      className="p-1 rounded text-theme-dim hover:text-rose-400 hover:bg-theme-bg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null
}
