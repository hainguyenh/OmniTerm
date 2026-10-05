import React from 'react'
import {
  ArrowLeft,
  Columns2,
  DownloadCloud,
  FolderGit2,
  GitGraph,
  Sparkles,
  RefreshCw,
  UploadCloud,
} from 'lucide-react'

import { Tooltip } from '../Tooltip'
import './git-ui.css'
import { GitProjectSelector } from './GitProjectSelector'
import type { GitProject, GitRepoStatus } from './gitTypes'

interface GitWorkspaceToolbarProps {
  projects: GitProject[]
  selectedPath: string | null
  currentBranch?: string
  isNotGit: boolean
  repoStatus: GitRepoStatus | null
  syncing: 'pull' | 'push' | 'fetch' | null
  syncNotice: string | null
  activeTab: 'changes' | 'graph' | 'maintenance'
  showGraphTab?: boolean
  onSelectProject: (path: string) => void
  onToggleBranchPopup: (anchorRect?: DOMRect) => void
  onSyncAction: (action: 'pull' | 'push' | 'fetch') => void
  onChangeTab: (tab: 'changes' | 'graph' | 'maintenance') => void
  onClose: () => void
}

export const GitWorkspaceToolbar: React.FC<GitWorkspaceToolbarProps> = ({
  projects,
  selectedPath,
  currentBranch,
  isNotGit,
  repoStatus,
  syncing,
  syncNotice,
  activeTab,
  showGraphTab = true,
  onSelectProject,
  onToggleBranchPopup,
  onSyncAction,
  onChangeTab,
  onClose,
}) => {
  const syncActions = [
    { action: 'fetch', label: 'Fetch', hint: 'Check for remote updates without changing local files', Icon: RefreshCw },
    { action: 'pull', label: 'Pull', hint: 'Download and merge upstream changes', Icon: DownloadCloud },
    { action: 'push', label: 'Push', hint: 'Upload local commits to upstream', Icon: UploadCloud },
  ] as const

  return (
    <div className="git-toolbar">
      <div className="git-toolbar-projects flex items-center gap-3 min-w-0 flex-wrap">
        <Tooltip content="Return to terminal session" placement="bottom">
          <button type="button" onClick={onClose} className="git-control">
            <ArrowLeft />
            <span>Terminal</span>
          </button>
        </Tooltip>
        {projects.length > 0 ? (
          <GitProjectSelector
            projects={projects}
            selectedPath={selectedPath}
            currentBranch={currentBranch}
            isNotGit={isNotGit}
            onSelectProject={onSelectProject}
            onToggleBranchPopup={onToggleBranchPopup}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-theme-dim">
            <FolderGit2 className="w-5 h-5 text-theme-accent" />
            <span>No workspace folder</span>
          </div>
        )}
      </div>
      <div className="git-toolbar-actions flex items-center gap-2 flex-wrap">
        {syncActions.map(({ action, label, hint, Icon }) => (
          <Tooltip key={action} content={hint} placement="bottom">
            <button
              type="button"
              onClick={() => onSyncAction(action)}
              disabled={syncing !== null || !selectedPath}
              aria-label={label}
              className="git-control bg-theme-bg"
            >
              <Icon className={syncing === action ? 'animate-spin text-theme-accent' : ''} />
              <span>{syncing === action ? `${label}…` : label}</span>
              {action === 'pull' && repoStatus && repoStatus.behind > 0 && <span className="git-count">{repoStatus.behind}</span>}
              {action === 'push' && repoStatus && repoStatus.ahead > 0 && <span className="git-count">{repoStatus.ahead}</span>}
            </button>
          </Tooltip>
        ))}

      </div>
      <nav className="git-workspace-nav" aria-label="Git workspace views">
        <button
          type="button"
          onClick={() => onChangeTab('changes')}
          aria-current={activeTab === 'changes' ? 'page' : undefined}
        >
          <Columns2 />
          <span>Changes & Diff</span>
          {repoStatus && <span className="git-nav-count">{repoStatus.files.length}</span>}
        </button>
        {showGraphTab && <button
          type="button"
          onClick={() => onChangeTab('graph')}
          aria-current={activeTab === 'graph' ? 'page' : undefined}
        >
          <GitGraph />
          <span>Commit Graph</span>
        </button>}
        <button
          type="button"
          onClick={() => onChangeTab('maintenance')}
          aria-current={activeTab === 'maintenance' ? 'page' : undefined}
        >
          <Sparkles />
          <span>Cleanup & Prune</span>
        </button>
      </nav>
      {(syncNotice || (repoStatus && (repoStatus.ahead > 0 || repoStatus.behind > 0 || repoStatus.conflict_count > 0))) && (
        <div className="w-full flex items-center flex-wrap gap-2 text-xs" role="status">
          {repoStatus && repoStatus.ahead > 0 && <span className="git-status-badge git-status-modified">{repoStatus.ahead} ahead · ready to push</span>}
          {repoStatus && repoStatus.behind > 0 && <span className="git-status-badge git-status-untracked">{repoStatus.behind} behind · available to pull</span>}
          {repoStatus && repoStatus.conflict_count > 0 && <span className="git-status-badge git-status-conflicted">{repoStatus.conflict_count} conflict(s) · resolve before committing</span>}
          {syncNotice && <span className="text-theme-fg break-words">{syncNotice}</span>}
        </div>
      )}
    </div>
  )
}
