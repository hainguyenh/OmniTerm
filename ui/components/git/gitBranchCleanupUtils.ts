import type { GitBranchInfo } from './gitTypes'

export type BranchCleanupRecommendation = 'high' | 'medium' | 'safe' | 'protected'

export interface BranchCleanupAnalysis {
  branch: GitBranchInfo
  recommendation: BranchCleanupRecommendation
  isCandidate: boolean
  reasons: string[]
  primaryReason: string
  daysOld: number | null
  formattedDate: string
  relativeDate: string
  isProtected: boolean
}

const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'trunk'])
const STALE_DAYS_THRESHOLD = 30

/**
 * Formats a unix timestamp into relative text (e.g. '3 days ago', '2 months ago').
 */
export function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return 'Unknown date'
  const now = Math.floor(Date.now() / 1000)
  const diffSec = Math.max(0, now - timestamp)
  const diffDays = Math.floor(diffSec / 86400)

  if (diffDays === 0) {
    const diffHours = Math.floor(diffSec / 3600)
    if (diffHours === 0) {
      const diffMins = Math.floor(diffSec / 60)
      return diffMins <= 1 ? 'Just now' : `${diffMins} minutes ago`
    }
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  }
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 30) return `${diffDays} days ago`
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30)
    return `${months} month${months > 1 ? 's' : ''} ago`
  }
  const years = Math.floor(diffDays / 365)
  return `${years} year${years > 1 ? 's' : ''} ago`
}

/**
 * Formats a unix timestamp into a standard human-readable date string.
 */
export function formatBranchTimestamp(timestamp?: number): string {
  if (!timestamp) return 'No commit date'
  const date = new Date(timestamp * 1000)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Analyzes a local branch and predicts whether it is an obsolete or stale candidate for cleanup.
 */
export function analyzeBranchForCleanup(
  branch: GitBranchInfo,
  currentBranch?: string,
): BranchCleanupAnalysis {
  const isCurrent = branch.is_current || branch.name === currentBranch
  const isProtectedName = PROTECTED_BRANCHES.has(branch.name.toLowerCase())
  const isProtected = isCurrent || isProtectedName

  const nowSec = Math.floor(Date.now() / 1000)
  const daysOld = branch.last_commit_timestamp
    ? Math.max(0, Math.floor((nowSec - branch.last_commit_timestamp) / 86400))
    : null

  const formattedDate = formatBranchTimestamp(branch.last_commit_timestamp)
  const relativeDate = formatRelativeTime(branch.last_commit_timestamp)

  const reasons: string[] = []

  if (isProtected) {
    const reason = isCurrent
      ? 'Current active branch'
      : `Primary default branch (${branch.name})`
    return {
      branch,
      recommendation: 'protected',
      isCandidate: false,
      reasons: [reason],
      primaryReason: reason,
      daysOld,
      formattedDate,
      relativeDate,
      isProtected: true,
    }
  }

  // Reason 1: Remote tracking branch was deleted upstream
  if (branch.is_gone) {
    reasons.push('Remote tracking branch deleted on server ([gone])')
  }

  // Reason 2: Merged into default/HEAD
  if (branch.is_merged) {
    reasons.push('Branch commits are fully merged')
  }

  // Reason 3: Stale / Inactive
  if (daysOld !== null && daysOld >= STALE_DAYS_THRESHOLD) {
    reasons.push(`Inactive for ${daysOld} days (last commit: ${relativeDate})`)
  }

  // Reason 4: Obsolete with server (behind upstream with 0 ahead commits)
  if (branch.behind > 0 && branch.ahead === 0) {
    reasons.push(`Behind remote by ${branch.behind} commit(s) with 0 unpushed changes`)
  }

  let recommendation: BranchCleanupRecommendation = 'safe'
  if (branch.is_gone || branch.is_merged) {
    recommendation = 'high'
  } else if (reasons.length > 0) {
    recommendation = 'medium'
  }

  const isCandidate = recommendation === 'high' || recommendation === 'medium'
  const primaryReason =
    reasons.length > 0 ? reasons[0] : 'Active branch with recent unmerged work'

  return {
    branch,
    recommendation,
    isCandidate,
    reasons,
    primaryReason,
    daysOld,
    formattedDate,
    relativeDate,
    isProtected: false,
  }
}
