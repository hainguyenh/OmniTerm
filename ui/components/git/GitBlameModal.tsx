import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { GitCommit, Loader2, X } from 'lucide-react'
import { createGitAPI } from '../../gitAPI'
import type { GitBlameLine } from './gitTypes'

interface GitBlameModalProps {
  cwd: string
  filePath: string
  onClose: () => void
}

export const GitBlameModal: React.FC<GitBlameModalProps> = ({
  cwd,
  filePath,
  onClose,
}) => {
  const [lines, setLines] = useState<GitBlameLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const api = createGitAPI()

    void api
      .getBlame(cwd, filePath)
      .then((res) => {
        if (active) {
          setLines(res)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (active) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [cwd, filePath])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const content = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Git Blame: ${filePath}`}
    >
      <div className="git-menu w-full max-w-5xl h-[80vh] bg-theme-bg border border-theme-border rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-theme-fg animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme-border bg-theme-sidebar flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <GitCommit className="w-4 h-4 text-theme-accent flex-shrink-0" />
            <span className="font-semibold text-theme-fg">Git Blame:</span>
            <span className="font-mono text-theme-accent truncate" title={filePath}>
              {filePath}
            </span>
            {lines.length > 0 && (
              <span className="text-theme-dim text-[11px] font-mono">
                ({lines.length} lines)
              </span>
            )}
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

        <div className="flex-1 overflow-auto font-mono text-xs select-text p-2 custom-scrollbar bg-theme-bg">
          {loading ? (
            <div className="flex items-center justify-center h-full gap-2 text-theme-dim">
              <Loader2 className="w-4 h-4 animate-spin text-theme-accent" />
              <span>Loading blame details...</span>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-theme-error">{error}</div>
          ) : lines.length === 0 ? (
            <div className="p-8 text-center text-theme-dim">No blame information available</div>
          ) : (
            <table className="w-full border-collapse leading-5">
              <tbody>
                {lines.map((item) => (
                  <tr
                    key={item.line_no}
                    className="hover:bg-theme-hover hover:text-theme-fg transition-colors group"
                  >
                    <td className="w-12 text-right pr-2 text-theme-dim/60 select-none py-0.5 border-r border-theme-border/30">
                      {item.line_no}
                    </td>
                    <td className="w-20 pl-2 pr-1 font-bold text-theme-accent/90 select-none py-0.5 truncate" title={item.commit}>
                      {item.commit.slice(0, 8)}
                    </td>
                    <td className="w-32 px-1 text-theme-dim select-none py-0.5 truncate" title={item.author}>
                      {item.author}
                    </td>
                    <td className="w-24 px-1 text-theme-dim/70 select-none py-0.5 text-[11px] whitespace-nowrap">
                      {item.date}
                    </td>
                    <td className="pl-3 pr-2 whitespace-pre-wrap break-all py-0.5 text-theme-fg/90">
                      {item.content || ' '}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined'
    ? createPortal(content, document.body)
    : null
}
