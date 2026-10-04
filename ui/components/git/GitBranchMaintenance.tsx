import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { createGitAPI } from '../../gitAPI'
import { GitBranchCleanupModal } from './GitBranchCleanupModal'
import type { GitBranchInfo } from './gitTypes'

interface GitBranchMaintenanceProps {
  cwd: string
  currentBranch?: string
  onClose: () => void
}

export function GitBranchMaintenance({ cwd, currentBranch, onClose }: GitBranchMaintenanceProps) {
  const api = useRef(createGitAPI()).current
  const generation = useRef(0)
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    setError(null)
    try {
      const result = await api.getBranches(cwd)
      if (request === generation.current) setBranches(result)
    } catch (reason: unknown) {
      if (request === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
      throw reason
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [api, cwd])

  useEffect(() => {
    setLoading(true)
    setBranches([])
    void refresh().catch(() => undefined)
    return () => { generation.current += 1 }
  }, [refresh])

  if (loading) return <div className="git-maintenance-empty" role="status">
    <Loader2 className="animate-spin" />
    <p>Reading branches…</p>
  </div>
  if (error) return <div className="git-maintenance-empty" role="alert">
    <p>{error}</p>
    <button type="button" className="git-control" onClick={() => void refresh().catch(() => undefined)}>Retry</button>
  </div>
  return <GitBranchCleanupModal
    cwd={cwd}
    currentBranch={currentBranch}
    branches={branches}
    onClose={onClose}
    onRefreshBranches={refresh}
  />
}
