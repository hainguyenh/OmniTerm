import { CheckCircle2, Clock3, GitBranch, ShieldCheck } from 'lucide-react'

import type { BranchCleanupAnalysis } from './gitBranchCleanupUtils'

interface GitBranchCleanupListProps {
  analyses: BranchCleanupAnalysis[]
  selected: Set<string>
  inspecting?: string
  onInspect: (name: string) => void
  onSelect: (name: string) => void
}

export function GitBranchCleanupList({ analyses, selected, inspecting, onInspect, onSelect }: GitBranchCleanupListProps) {
  return (
    <div className="git-cleanup-list" aria-label="Local branches">
      <div className="git-cleanup-list-heading">
        <span>LOCAL BRANCHES</span>
        <span>{analyses.length} shown</span>
      </div>
      {analyses.length === 0 ? (
        <div className="git-maintenance-empty">
          <CheckCircle2 />
          <strong>No matching branches</strong>
          <p>Try another filter or refresh remote references.</p>
        </div>
      ) : analyses.map((analysis) => (
        <div key={analysis.branch.name} className={`git-cleanup-row ${inspecting === analysis.branch.name ? 'is-selected' : ''}`}>
          <input
            type="checkbox"
            aria-label={`Select ${analysis.branch.name}`}
            disabled={analysis.isProtected}
            checked={selected.has(analysis.branch.name)}
            onChange={() => onSelect(analysis.branch.name)}
          />
          <button
            type="button"
            className="git-cleanup-row-inspect"
            aria-pressed={inspecting === analysis.branch.name}
            onClick={() => onInspect(analysis.branch.name)}
          >
            <div className="git-cleanup-row-name">
              <GitBranch />
              <strong title={analysis.branch.name}>{analysis.branch.name}</strong>
            </div>
            <span className="git-cleanup-row-reason">{analysis.primaryReason}</span>
            <div className="git-cleanup-row-meta">
              {analysis.isProtected ? <span className="git-status-badge"><ShieldCheck />Protected</span> : analysis.branch.is_merged ? <span className="git-status-badge git-status-added">Merged</span> : analysis.branch.is_gone ? <span className="git-status-badge git-status-untracked">Remote gone</span> : <span className="git-status-badge">Inactive</span>}
              <span>
                <Clock3 />
                {analysis.relativeDate}
              </span>
            </div>
          </button>
        </div>
      ))}
    </div>
  )
}
