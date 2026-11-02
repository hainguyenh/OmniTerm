import { useCallback, useEffect, useRef, useState } from 'react'

import type { LaunchLogLine } from '../src/types'
import type { VsCodeLaunchAPI } from './vscodeLaunchAPI'

export interface RunLogBuffer {
  lines: LaunchLogLine[]
  nextSeq: number
  truncated: boolean
}

const LOG_POLL_MS = 150
const MAX_UI_LINES = 2_000

export function useRunLogs(
  api: VsCodeLaunchAPI,
  resolvedRunId: string | null,
  isRunning: boolean,
) {
  const [buffers, setBuffers] = useState<Record<string, RunLogBuffer>>({})
  const nextSeqRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!resolvedRunId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const pull = async () => {
      const afterSeq = nextSeqRef.current[resolvedRunId] ?? 0
      const chunk = await api.readLogs(resolvedRunId, afterSeq)
      if (cancelled) return

      nextSeqRef.current[resolvedRunId] = Math.max(afterSeq, chunk.nextSeq)

      if (chunk.lines.length > 0 || chunk.truncated) {
        setBuffers((prev) => {
          const existing = prev[resolvedRunId] ?? { lines: [], nextSeq: 0, truncated: false }
          const freshLines = chunk.lines.filter((line) => line.seq > existing.nextSeq)
          if (freshLines.length === 0 && (!chunk.truncated || existing.truncated)) {
            return prev
          }
          const combined = [...existing.lines, ...freshLines]
          const trimmed =
            combined.length > MAX_UI_LINES
              ? combined.slice(combined.length - MAX_UI_LINES)
              : combined
          return {
            ...prev,
            [resolvedRunId]: {
              lines: trimmed,
              nextSeq: Math.max(existing.nextSeq, chunk.nextSeq),
              truncated: existing.truncated || chunk.truncated || combined.length > MAX_UI_LINES,
            },
          }
        })
      }

      if (isRunning) {
        timer = setTimeout(() => {
          void pull()
        }, LOG_POLL_MS)
      }
    }

    void pull()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [api, resolvedRunId, isRunning])

  const clearBuffer = useCallback((runId: string) => {
    setBuffers((prev) => {
      const current = prev[runId]
      return {
        ...prev,
        [runId]: {
          lines: [],
          nextSeq: current?.nextSeq ?? 0,
          truncated: false,
        },
      }
    })
  }, [])

  return {
    buffers,
    activeBuffer: resolvedRunId ? buffers[resolvedRunId] : undefined,
    clearBuffer,
  }
}
