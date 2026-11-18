import { useMemo } from 'react'

import { refreshNow, useVcs } from '../../ide/features/vcs/store'
import { Icon, IconButton } from '../../ide/ui'
import { editorService } from '../../ide/workbench/contributions'

import { commitSection } from './scmCommit'
import { buildScmSections, type ScmChange, type ScmSection } from './scmModel'
import { useScmDrafts } from './scmStore'

const LETTER_COLORS: Record<string, string> = {
  M: 'var(--vcs-modified, #e2c08d)',
  A: 'var(--vcs-added, #81b88b)',
  U: 'var(--vcs-untracked, #73c991)',
  D: 'var(--vcs-deleted, #c74e39)',
  R: 'var(--vcs-added, #81b88b)',
  '!': 'var(--danger, #c74e39)',
}

function ChangeRow({ change }: { change: ScmChange }) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded px-2 py-0.5 text-left hover:bg-[var(--bg-hover)]"
        title={change.relPath}
        data-testid="scm-change"
        onClick={() => void editorService().openFile(change.path)}
      >
        <span className="truncate">{change.name}</span>
        {change.dir && <span className="min-w-0 truncate text-[11px] text-[var(--fg-muted)]">{change.dir}</span>}
        <span className="ml-auto w-3 flex-none text-center font-semibold" style={{ color: LETTER_COLORS[change.letter] }}>
          {change.letter}
        </span>
      </button>
    </li>
  )
}

function Section({ section }: { section: ScmSection }) {
  const message = useScmDrafts((s) => s.messages[section.root] ?? '')
  const folded = useScmDrafts((s) => s.folded[section.root] ?? false)
  const busy = useScmDrafts((s) => s.busy === section.root)
  const setMessage = useScmDrafts((s) => s.setMessage)
  const toggleFolded = useScmDrafts((s) => s.toggleFolded)
  const dirty = section.changes.length > 0
  const canCommit = dirty && message.trim().length > 0 && !busy
  return (
    <section className="border-b border-[var(--border)] pb-1" data-testid="scm-section">
      <div className="flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-semibold"
          aria-expanded={!folded}
          onClick={() => toggleFolded(section.root)}
        >
          <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={12} />
          <span className="truncate" title={section.root}>{section.name}</span>
        </button>
        <span className="flex-none truncate text-[11px] text-[var(--fg-muted)]" data-testid="scm-branch">
          {section.operation ? `${section.operation} · ` : ''}
          {section.branch ?? 'detached'}
          {dirty ? '*' : ''}
        </span>
        <IconButton icon="refresh" size="small" title="Refresh" onClick={() => void refreshNow()} />
        {dirty && (
          <span className="flex-none rounded-full bg-[var(--accent)] px-1.5 text-[10px] text-[var(--accent-fg,#fff)]" data-testid="scm-count">
            {section.changes.length}
          </span>
        )}
      </div>
      {!folded && (
        <div className="px-2">
          <textarea
            className="mb-1 w-full resize-none rounded border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1 text-[12px]"
            rows={2}
            placeholder={`Message (Ctrl+Enter to commit on "${section.branch ?? 'HEAD'}")`}
            aria-label={`Commit message for ${section.name}`}
            value={message}
            onChange={(event) => setMessage(section.root, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void commitSection(section)
              }
            }}
          />
          <button
            type="button"
            className="mb-1 flex w-full items-center justify-center gap-1 rounded bg-[var(--accent)] px-2 py-1 text-[12px] text-[var(--accent-fg,#fff)] disabled:opacity-50"
            disabled={!canCommit}
            data-testid="scm-commit"
            onClick={() => void commitSection(section)}
          >
            <Icon name="check" size={14} />
            Commit
          </button>
          <ul>{section.changes.map((change) => <ChangeRow key={change.path} change={change} />)}</ul>
          {!dirty && <div className="px-1 py-0.5 text-[11px] text-[var(--fg-muted)]">No changes</div>}
        </div>
      )}
    </section>
  )
}

/**
 * Source Control, one section per project of the workspace like VS Code: the repository's branch,
 * its own commit message and Commit button, and its changes. Projects that are not git repositories
 * do not appear.
 */
export function ScmToolWindow() {
  const roots = useVcs((s) => s.roots)
  const heads = useVcs((s) => s.heads)
  const operations = useVcs((s) => s.operations)
  const status = useVcs((s) => s.status)
  const sections = useMemo(() => buildScmSections(roots, heads, operations, status), [roots, heads, operations, status])
  if (sections.length === 0) {
    return <div className="p-4 text-center text-[var(--fg-muted)]" data-testid="scm-empty">No git repositories in this workspace</div>
  }
  return (
    <div className="h-full overflow-auto text-[12px]" data-testid="scm-tool-window">
      {sections.map((section) => <Section key={section.root} section={section} />)}
    </div>
  )
}
