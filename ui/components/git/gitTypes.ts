export type GitFileStatus =
  | 'unmodified'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted'
  | 'type_changed'

export interface GitFileChange {
  path: string
  orig_path?: string
  staged: GitFileStatus
  unstaged: GitFileStatus
  is_conflicted: boolean
}

export interface GitRepoStatus {
  repo_root: string
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  is_detached: boolean
  files: GitFileChange[]
  conflict_count: number
  /** Set only when `repo_root` is a linked worktree: the root of its main worktree. */
  main_worktree?: string
}

/** One entry of `git worktree list`; the main worktree comes first. */
export interface GitWorktreeInfo {
  path: string
  /** Short branch name; absent when detached or bare. */
  branch?: string
  head?: string
  is_main: boolean
  /** The worktree the listing was requested from. */
  is_current: boolean
  is_detached: boolean
  is_bare: boolean
  is_locked: boolean
  is_prunable: boolean
}

export type GitDiffLineType = 'context' | 'addition' | 'deletion'

export interface GitDiffLine {
  line_type: GitDiffLineType
  old_lineno?: number
  new_lineno?: number
  content: string
}

export interface GitDiffHunk {
  old_start: number
  old_lines: number
  new_start: number
  new_lines: number
  header: string
  lines: GitDiffLine[]
}

export interface GitFileDiff {
  path: string
  is_binary: boolean
  hunks: GitDiffHunk[]
}

export interface GitCommitSummary {
  id: string
  short_id: string
  summary: string
  author_name: string
  author_email: string
  timestamp: number
  parents: string[]
}

export interface GitProject {
  id: string
  name: string
  path: string
  category?: string
}

export interface GitBranchInfo {
  name: string
  is_current: boolean
  is_remote: boolean
  upstream?: string
  ahead: number
  behind: number
  is_gone: boolean
  last_commit_timestamp?: number
  last_commit_message?: string
  last_commit_author?: string
  is_merged?: boolean
}

export interface GitBranchDeleteFailure {
  branch: string
  reason: string
}

export interface GitDeleteBranchesResult {
  deleted: string[]
  failed: GitBranchDeleteFailure[]
  /** Linked worktrees removed because they had a deleted branch checked out. */
  removed_worktrees?: string[]
}

export interface GitBlameLine {
  commit: string
  author: string
  date: string
  line_no: number
  content: string
}

export interface GitStashEntry {
  index: number
  name: string
  message: string
  timestamp?: string
}

export interface GitFileContext {
  repo_root: string
  /** Forward-slashed, relative to `repo_root` — the path git commands take. */
  relative_path: string
  branch?: string
}

export interface GitFileHistoryEntry {
  commit: GitCommitSummary
  /** The file's path at this commit, which predates a later rename. */
  path: string
}

/** 1-based inclusive line range of a file. */
export interface GitLineRange {
  start: number
  end: number
}

export interface GitBranchComparison {
  base_branch: string
  target_branch: string
  commits_ahead: GitCommitSummary[]
  commits_behind: GitCommitSummary[]
  files: GitFileChange[]
}

