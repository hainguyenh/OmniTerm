import React from 'react'
import { GitCommitHorizontal } from 'lucide-react'

interface GitCommitFormProps {
  message: string
  amend: boolean
  committing: boolean
  canCommit: boolean
  onChangeMessage: (msg: string) => void
  onChangeAmend: (amend: boolean) => void
  onSubmit: () => void
}

export const GitCommitForm: React.FC<GitCommitFormProps> = ({
  message,
  amend,
  committing,
  canCommit,
  onChangeMessage,
  onChangeAmend,
  onSubmit,
}) => {
  const titleLine = message.split('\n')[0] ?? ''
  const isTitleOverLimit = titleLine.length > 72

  return (
    <div className="border-t border-theme-border p-3 bg-theme-sidebar flex flex-col gap-3"
      role="group"
      aria-label="Create commit"
    >
      <label className="text-xs font-semibold text-theme-fg" htmlFor="git-commit-message">Commit message</label>
      <div className="relative">
        <textarea
          id="git-commit-message"
          value={message}
          onChange={(e) => onChangeMessage(e.target.value)}
          placeholder="Commit message (Ctrl+Enter to commit)..."
          rows={3}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              if (canCommit && !committing) onSubmit()
            }
          }}
          className="w-full bg-theme-bg border border-theme-border rounded-md p-2.5 pb-6 text-xs text-theme-fg placeholder:text-theme-dim focus:outline-none focus:border-theme-accent resize-none font-sans"
        />
        {titleLine.length > 0 && (
          <span
            className={`absolute bottom-2 right-2 text-[10px] font-mono ${
              isTitleOverLimit ? 'text-theme-error font-semibold' : 'text-theme-dim'
            }`}
          >
            {titleLine.length}/72
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 min-h-8 cursor-pointer text-theme-dim hover:text-theme-fg text-xs">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => onChangeAmend(e.target.checked)}
            className="w-4 h-4 rounded border-theme-border accent-theme-accent"
          />
          <span title="Update the previous commit instead of creating a new one">Amend last commit</span>
        </label>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canCommit || committing}
          className="git-control git-primary min-h-9 border-transparent disabled:opacity-50"
        >
          <GitCommitHorizontal />
          {committing ? 'Committing...' : 'Commit'}
        </button>
      </div>
    </div>
  )
}
