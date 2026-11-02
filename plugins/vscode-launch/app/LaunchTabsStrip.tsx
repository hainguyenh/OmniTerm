import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { Tooltip } from '../../../ui/components/Tooltip'
import type { LaunchRunSummary } from '../src/types'
import { statusDotClass } from './openUrl'

export interface LaunchTabsStripProps {
  runs: LaunchRunSummary[]
  activeRunId: string | null
  onSelectRun: (runId: string) => void
  onCloseRun?: (runId: string) => void
  onContextMenuRun: (e: React.MouseEvent, run: LaunchRunSummary) => void
}

export const LaunchTabsStrip: React.FC<LaunchTabsStripProps> = ({
  runs,
  activeRunId,
  onSelectRun,
  onCloseRun,
  onContextMenuRun,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [tabsScroll, setTabsScroll] = useState({
    hasOverflow: false,
    thumbWidth: 0,
    thumbLeft: 0,
  })

  const updateTabsScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    const hasOverflow = maxScroll > 2
    if (!hasOverflow) {
      setTabsScroll((prev) =>
        prev.hasOverflow ? { hasOverflow: false, thumbWidth: 0, thumbLeft: 0 } : prev,
      )
      return
    }
    const thumbWidth = Math.max(12, (el.clientWidth / el.scrollWidth) * 100)
    const scrollRatio = Math.max(0, Math.min(1, el.scrollLeft / maxScroll))
    const thumbLeft = scrollRatio * (100 - thumbWidth)
    setTabsScroll({ hasOverflow: true, thumbWidth, thumbLeft })
  }, [])

  useEffect(() => {
    updateTabsScroll()
    window.addEventListener('resize', updateTabsScroll)
    return () => window.removeEventListener('resize', updateTabsScroll)
  }, [updateTabsScroll, runs.length])

  const handleTabsWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY
    }
  }, [])

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current
    if (!el) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth)
  }, [])

  return (
    <div className="relative flex-1 min-w-0 flex items-center">
      <div
        ref={containerRef}
        role="tablist"
        aria-label="Launch runs"
        onWheel={handleTabsWheel}
        onScroll={updateTabsScroll}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar w-full py-0.5"
      >
        {runs.length === 0 ? (
          <span className="text-xs text-theme-dim px-1.5 py-0.5">No launch runs yet</span>
        ) : (
          runs.map((run) => {
            const selected = run.runId === activeRunId
            const isRunning = run.status === 'starting' || run.status === 'running'
            const closeTooltip = isRunning ? 'Stop & Close Console' : 'Close Console'
            const showExitCode =
              (run.status === 'exited' || run.status === 'failed') &&
              run.exitCode !== undefined &&
              run.exitCode !== null
            const tabTooltip = `${run.name} (${run.type})${
              run.status ? ` • ${run.status}` : ''
            }`
            return (
              <Tooltip key={run.runId} content={tabTooltip} placement="top">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={tabTooltip}
                  onClick={() => onSelectRun(run.runId)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    e.nativeEvent?.preventDefault?.()
                    e.nativeEvent?.stopImmediatePropagation?.()
                    onContextMenuRun(e, run)
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium shrink-0 transition-colors ${
                    selected
                      ? 'bg-theme-bg text-theme-fg border border-theme-border'
                      : 'text-theme-dim hover:text-theme-fg hover:bg-theme-hover'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(run.status, run.mode)}`}
                  />
                  <span className="truncate max-w-[150px]">{run.name}</span>
                  <span className="text-[10px] font-mono text-theme-dim">({run.type})</span>
                  {run.relativeFolder !== '.' && (
                    <span className="text-[10px] font-mono text-theme-dim">
                      {run.relativeFolder}
                    </span>
                  )}
                  {showExitCode ? (
                    <span className="text-[10px] font-mono text-theme-dim tabular-nums">
                      exit {run.exitCode}
                    </span>
                  ) : run.pid !== undefined ? (
                    <span className="text-[10px] font-mono text-theme-dim tabular-nums">
                      :{run.pid}
                    </span>
                  ) : null}
                  {onCloseRun && (
                    <Tooltip content={closeTooltip} placement="bottom">
                      <span
                        role="button"
                        aria-label={closeTooltip}
                        onClick={(e) => {
                          e.stopPropagation()
                          onCloseRun(run.runId)
                        }}
                        className="ml-0.5 p-0.5 rounded opacity-40 hover:opacity-100 hover:text-theme-error hover:bg-theme-hover transition-opacity cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </span>
                    </Tooltip>
                  )}
                </button>
              </Tooltip>
            )
          })
        )}
      </div>

      {tabsScroll.hasOverflow && (
        <div
          role="scrollbar"
          aria-orientation="horizontal"
          aria-label="Launch runs scrollbar"
          aria-valuenow={Math.round(tabsScroll.thumbLeft)}
          onClick={handleTrackClick}
          className="absolute -bottom-1 left-0 right-0 h-[2.5px] rounded-full bg-theme-border/30 cursor-pointer overflow-hidden pointer-events-auto"
        >
          <div
            className="h-full bg-theme-accent/70 rounded-full transition-all duration-75 absolute"
            style={{
              width: `${tabsScroll.thumbWidth}%`,
              left: `${tabsScroll.thumbLeft}%`,
            }}
          />
        </div>
      )}
    </div>
  )
}

export default LaunchTabsStrip
