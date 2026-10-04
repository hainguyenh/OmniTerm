import React from 'react'
import { ChevronDown, FolderGit2, GitBranch } from 'lucide-react'
import type { GitProject } from './gitTypes'
import './git-ui.css'

interface GitProjectSelectorProps {
  projects: GitProject[]
  selectedPath: string | null
  currentBranch?: string
  isNotGit?: boolean
  onSelectProject: (path: string) => void
  onToggleBranchPopup?: (anchorRect?: DOMRect) => void
}

export const GitProjectSelector: React.FC<GitProjectSelectorProps> = ({
  projects,
  selectedPath,
  currentBranch,
  isNotGit = false,
  onSelectProject,
  onToggleBranchPopup,
}) => {
  if (projects.length === 0) {
    return null
  }

  // Find exact matching project or default to first
  const current = projects.find((p) => p.path.toLowerCase() === selectedPath?.toLowerCase()) ?? projects[0]

  return (
    <div className="git-project-selector">
      <FolderGit2 className="w-5 h-5 text-theme-accent flex-shrink-0" />
      <div className="git-project-select">
        <select
          value={current?.path ?? ''}
          onChange={(e) => onSelectProject(e.target.value)}
          aria-label="Select Git Project"
          title={current?.path}
        >
          {projects.map((proj) => (
            <option key={proj.id} value={proj.path}>
              {proj.name} ({proj.path})
            </option>
          ))}
        </select>
        <ChevronDown className="git-project-chevron" aria-hidden="true" />
      </div>
      {currentBranch ? (
        <button
          type="button"
          onClick={(e) => onToggleBranchPopup?.(e.currentTarget.getBoundingClientRect())}
          onContextMenu={(e) => {
            e.preventDefault()
            onToggleBranchPopup?.(e.currentTarget.getBoundingClientRect())
          }}
          aria-label={`Current branch: ${currentBranch}`}
          className="git-control git-branch-button"
          title={`Branch: ${currentBranch} — switch or manage branches`}
        >
          <GitBranch className="text-theme-accent" />
          <span className="truncate">{currentBranch}</span>
          <ChevronDown className="text-theme-dim" />
        </button>
      ) : isNotGit ? (
        <button
          type="button"
          onClick={(e) => onToggleBranchPopup?.(e.currentTarget.getBoundingClientRect())}
          className="git-control git-control-warning"
          title="Not a Git repository (click to initialize)"
        >
          Initialize Git
        </button>
      ) : null}
    </div>
  )
}
