import React, { useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { GitBlameModal } from './GitBlameModal'
import { GitBranchCompareModal } from './GitBranchCompareModal'
import { GitChangesHeader } from './GitChangesHeader'
import { GitChangeGroup, GitChangesTree } from './GitChangesTree'
import { GitCommitForm } from './GitCommitForm'
import { GitContextMenu } from './GitContextMenu'
import { GitFileRow } from './GitFileRow'
import { GitStashModal } from './GitStashModal'
import {
  buildGitTree,
  collectFolderPaths,
  getFolderCheckState,
  type GitTreeFolderNode,
} from './gitTreeUtils'
import type { GitRepoStatus } from './gitTypes'

interface GitCommitSectionProps {
  status: GitRepoStatus | null
  loading: boolean
  selectedFile: string | null
  cwd?: string
  currentBranch?: string
  onRefresh: () => void
  onSelectFile: (path: string, staged: boolean, targetBranch?: string) => void
  onCommit: (message: string, amend: boolean) => Promise<void>
  onRevert: (paths: string[]) => Promise<void>
}

export const GitCommitSection: React.FC<GitCommitSectionProps> = ({
  status,
  loading,
  selectedFile,
  cwd,
  currentBranch,
  onRefresh,
  onSelectFile,
  onCommit,
  onRevert,
}) => {
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [amend, setAmend] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [staging, setStaging] = useState(false)
  const [stageError, setStageError] = useState<string | null>(null)
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [unstagedExpanded, setUnstagedExpanded] = useState(true)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    filePath: string
    isStaged: boolean
  } | null>(null)
  const [blameFile, setBlameFile] = useState<string | null>(null)
  const [compareFile, setCompareFile] = useState<string | null>(null)
  const [stashModalOpen, setStashModalOpen] = useState(false)

  const [viewMode, setViewMode] = useState<'tree' | 'list'>(() => {
    try {
      const stored = localStorage.getItem('omniterm:git-view-mode')
      return stored === 'list' ? 'list' : 'tree'
    } catch {
      return 'tree'
    }
  })

  const handleToggleViewMode = () => {
    const next = viewMode === 'tree' ? 'list' : 'tree'
    setViewMode(next)
    try {
      localStorage.setItem('omniterm:git-view-mode', next)
    } catch {
      // storage unavailable
    }
  }

  const files = useMemo(() => status?.files ?? [], [status?.files])
  const stagedFiles = useMemo(() => files.filter((f) => f.staged !== 'unmodified'), [files])
  const unstagedFiles = useMemo(() => files.filter((f) => f.unstaged !== 'unmodified'), [files])

  const q = search.toLowerCase().trim()
  const filteredStagedFiles = useMemo(
    () => stagedFiles.filter((f) => q === '' || f.path.toLowerCase().includes(q)),
    [stagedFiles, q],
  )
  const filteredUnstagedFiles = useMemo(
    () => unstagedFiles.filter((f) => q === '' || f.path.toLowerCase().includes(q)),
    [unstagedFiles, q],
  )

  const stagedTree = useMemo(() => buildGitTree(filteredStagedFiles), [filteredStagedFiles])
  const unstagedTree = useMemo(() => buildGitTree(filteredUnstagedFiles), [filteredUnstagedFiles])

  const allVisibleFiles = useMemo(
    () => [...filteredStagedFiles, ...filteredUnstagedFiles],
    [filteredStagedFiles, filteredUnstagedFiles],
  )

  const allChecked =
    allVisibleFiles.length > 0 && allVisibleFiles.every((f) => checkedPaths.has(f.path))
  const someChecked = allVisibleFiles.some((f) => checkedPaths.has(f.path))

  const toggleAll = () => {
    if (allChecked) {
      setCheckedPaths(new Set())
    } else {
      setCheckedPaths(new Set(allVisibleFiles.map((f) => f.path)))
    }
  }

  const togglePath = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(checkedPaths)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    setCheckedPaths(next)
  }

  const toggleFolderCollapse = (folderPath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(collapsedFolders)
    if (next.has(folderPath)) {
      next.delete(folderPath)
    } else {
      next.add(folderPath)
    }
    setCollapsedFolders(next)
  }

  const toggleFolderCheck = (folder: GitTreeFolderNode, e: React.MouseEvent) => {
    e.stopPropagation()
    const { checked } = getFolderCheckState(folder, checkedPaths)
    const next = new Set(checkedPaths)
    if (checked) {
      for (const f of folder.allFiles) {
        next.delete(f.path)
      }
    } else {
      for (const f of folder.allFiles) {
        next.add(f.path)
      }
    }
    setCheckedPaths(next)
  }

  const handleExpandAll = () => setCollapsedFolders(new Set())
  const handleCollapseAll = () => {
    setCollapsedFolders(new Set([...collectFolderPaths(stagedTree), ...collectFolderPaths(unstagedTree)]))
  }

  const handleContextMenu = (e: React.MouseEvent, filePath: string, isStaged: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, filePath, isStaged })
  }

  const updateStage = async (paths: string[], isStaged: boolean) => {
    if (!cwd || staging || paths.length === 0) return
    setStaging(true)
    setStageError(null)
    try {
      const api = createGitAPI()
      if (isStaged) await api.unstage(cwd, paths)
      else await api.stage(cwd, paths)
      onRefresh()
    } catch (error: unknown) {
      setStageError(error instanceof Error ? error.message : String(error))
    } finally {
      setStaging(false)
    }
  }

  const handleToggleStage = (path: string, isStaged: boolean) => {
    void updateStage([path], isStaged)
  }
  const handleStageFile = (path: string) => handleToggleStage(path, false)
  const handleUnstageFile = (path: string) => handleToggleStage(path, true)
  const handleStageAll = () => {
    void updateStage(unstagedFiles.map((file) => file.path), false)
  }
  const handleUnstageAll = () => {
    void updateStage(stagedFiles.map((file) => file.path), true)
  }

  const handleDeleteFile = async (filePath: string) => {
    if (!cwd) return
    if (!window.confirm(`Are you sure you want to permanently delete '${filePath}'?`)) return
    await createGitAPI().deleteFile(cwd, filePath)
    onRefresh()
  }

  const handleCommit = async () => {
    if (!message.trim() || committing) return
    setCommitting(true)
    try {
      if (stagedFiles.length === 0 && checkedPaths.size > 0 && cwd) {
        await createGitAPI().stage(cwd, Array.from(checkedPaths))
      }
      await onCommit(message, amend)
      setMessage('')
      setAmend(false)
      setCheckedPaths(new Set())
    } finally {
      setCommitting(false)
    }
  }

  const handleRevertSelected = async () => {
    const targets = Array.from(checkedPaths)
    if (targets.length === 0 || reverting) return
    if (!window.confirm(`Discard changes to ${targets.length} file(s)?`)) return
    setReverting(true)
    try {
      await onRevert(targets)
      setCheckedPaths(new Set())
    } finally {
      setReverting(false)
    }
  }

  const renderTree = (isStaged: boolean) => (
    <GitChangesTree
      nodes={isStaged ? stagedTree : unstagedTree}
      isStaged={isStaged}
      checkedPaths={checkedPaths}
      collapsedFolders={collapsedFolders}
      selectedFile={selectedFile}
      staging={staging || !cwd}
      onToggleCheck={togglePath}
      onToggleFolderCheck={toggleFolderCheck}
      onToggleFolder={toggleFolderCollapse}
      onSelectFile={onSelectFile}
      onToggleStage={handleToggleStage}
      onContextMenu={handleContextMenu}
    />
  )

  const renderSectionHeader = (
    title: string,
    count: number,
    isExpanded: boolean,
    onToggle: () => void,
    actionButton?: React.ReactNode,
  ) => (
    <GitChangeGroup
      title={title}
      count={count}
      isExpanded={isExpanded}
      onToggle={onToggle}
      actionButton={actionButton}
    />
  )

  const canCommit = Boolean(message.trim() && (someChecked || amend))

  return (
    <div className="flex flex-col h-full select-none text-xs">
      <GitChangesHeader
        totalFiles={files.length}
        allChecked={allChecked}
        someChecked={someChecked}
        reverting={reverting}
        loading={loading}
        viewMode={viewMode}
        search={search}
        onToggleAll={toggleAll}
        onRevertSelected={handleRevertSelected}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        onToggleViewMode={handleToggleViewMode}
        onOpenStash={() => setStashModalOpen(true)}
        onRefresh={onRefresh}
        onChangeSearch={setSearch}
      />

      {stageError && <p role="alert" className="px-3 py-2 text-theme-error bg-theme-error/10 break-words">{stageError}</p>}

      <div className="flex-1 overflow-y-auto min-h-0 py-1 font-sans custom-scrollbar">
        {files.length === 0 ? (
          <div className="p-4 text-center text-theme-dim">No local changes</div>
        ) : (
          <>
            {stagedFiles.length > 0 && (
              <div className="mb-1">
                {renderSectionHeader(
                  'Staged Changes',
                  stagedFiles.length,
                  stagedExpanded,
                  () => setStagedExpanded(!stagedExpanded),
                  <button
                    type="button"
                    onClick={handleUnstageAll}
                    title="Unstage all"
                    disabled={staging || !cwd}
                    className="git-control git-control-warning"
                  >
                    <Minus />
                    <span>Unstage all</span>
                  </button>,
                )}
                {stagedExpanded && (
                  <div className="py-0.5">
                    {filteredStagedFiles.length === 0 ? (
                      <div className="px-4 py-1 text-[11px] text-theme-dim/60">No matching staged files</div>
                    ) : viewMode === 'tree' ? (
                      renderTree(true)
                    ) : (
                      filteredStagedFiles.map((file) => (
                        <GitFileRow
                          key={`s:${file.path}`}
                          file={file}
                          displayName={file.path}
                          isChecked={checkedPaths.has(file.path)}
                          isSelected={selectedFile === file.path}
                          isStaged={true}
                          onToggleCheck={togglePath}
                          onSelect={(p, st) => onSelectFile(p, st)}
                          staging={staging || !cwd}
                          onToggleStage={handleToggleStage}
                          onContextMenu={handleContextMenu}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              {renderSectionHeader(
                'Changes',
                unstagedFiles.length,
                unstagedExpanded,
                () => setUnstagedExpanded(!unstagedExpanded),
                unstagedFiles.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleStageAll}
                    title="Stage all"
                    disabled={staging || !cwd}
                    className="git-control git-stage-action"
                  >
                    <Plus />
                    <span>Stage all</span>
                  </button>
                ) : undefined,
              )}
              {unstagedExpanded && (
                <div className="py-0.5">
                  {unstagedFiles.length === 0 ? (
                    <div className="px-4 py-2 text-[11px] text-theme-dim/60">No unstaged changes</div>
                  ) : filteredUnstagedFiles.length === 0 ? (
                    <div className="px-4 py-1 text-[11px] text-theme-dim/60">No matching unstaged files</div>
                  ) : viewMode === 'tree' ? (
                    renderTree(false)
                  ) : (
                    filteredUnstagedFiles.map((file) => (
                      <GitFileRow
                        key={`u:${file.path}`}
                        file={file}
                        displayName={file.path}
                        isChecked={checkedPaths.has(file.path)}
                        isSelected={selectedFile === file.path}
                        isStaged={false}
                        onToggleCheck={togglePath}
                        onSelect={(p, st) => onSelectFile(p, st)}
                        staging={staging || !cwd}
                        onToggleStage={handleToggleStage}
                        onContextMenu={handleContextMenu}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {contextMenu && (
        <GitContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          filePath={contextMenu.filePath}
          isStaged={contextMenu.isStaged}
          onStage={handleStageFile}
          onUnstage={handleUnstageFile}
          onDiscard={(p) => {
            void onRevert([p]).then(onRefresh)
          }}
          onDelete={handleDeleteFile}
          onBlame={(p) => setBlameFile(p)}
          onCompareBranch={(p) => setCompareFile(p)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {blameFile && cwd && (
        <GitBlameModal
          cwd={cwd}
          filePath={blameFile}
          onClose={() => setBlameFile(null)}
        />
      )}

      {compareFile && cwd && (
        <GitBranchCompareModal
          cwd={cwd}
          filePath={compareFile}
          currentBranch={currentBranch}
          onSelectBranch={(branch) => {
            onSelectFile(compareFile, false, branch)
            setCompareFile(null)
          }}
          onClose={() => setCompareFile(null)}
        />
      )}

      {stashModalOpen && cwd && (
        <GitStashModal
          cwd={cwd}
          onClose={() => setStashModalOpen(false)}
          onRefresh={onRefresh}
        />
      )}

      <GitCommitForm
        message={message}
        amend={amend}
        committing={committing}
        canCommit={canCommit}
        onChangeMessage={setMessage}
        onChangeAmend={setAmend}
        onSubmit={handleCommit}
      />
    </div>
  )
}
