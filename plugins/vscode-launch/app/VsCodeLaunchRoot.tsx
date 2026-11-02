import { Suspense, lazy, useEffect, useMemo } from 'react'

import type { LaunchTerminalPopoutSpec } from './LaunchConsoleDrawer'
import {
  registerLaunchApi,
  setLaunchAvailable,
  setRunsSnapshot,
  useLaunchStore,
} from './launchStore'
import { createVsCodeLaunchAPI, type VsCodeLaunchAPI } from './vscodeLaunchAPI'

const LazyLaunchConsoleDrawer = lazy(() => import('./LaunchConsoleDrawer'))

export interface VsCodeLaunchRootProps {
  api?: VsCodeLaunchAPI
  fontSize?: number
  fontFamilyMono?: string
  onOpenInTerminal: (spec: LaunchTerminalPopoutSpec) => void
}

const PROBE_DELAYS_MS = [0, 500, 1_000, 2_000, 4_000]
const AVAILABILITY_POLL_MS = 5_000
const RUNS_POLL_MS = 1_500

export function VsCodeLaunchRoot({
  api: providedApi,
  fontSize,
  fontFamilyMono,
  onOpenInTerminal,
}: VsCodeLaunchRootProps) {
  const api = useMemo(() => providedApi ?? createVsCodeLaunchAPI(), [providedApi])
  const available = useLaunchStore((s) => s.available)
  const consoleOpen = useLaunchStore((s) => s.consoleOpen)
  const hasLiveRuns = useLaunchStore((s) =>
    s.runs.some((r) => r.status === 'starting' || r.status === 'running'),
  )

  useEffect(() => {
    registerLaunchApi(api)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const pollAvailability = () => {
      void api.info().then((res) => {
        if (cancelled) return
        setLaunchAvailable(res.available, res.editors)
        timer = setTimeout(pollAvailability, AVAILABILITY_POLL_MS)
      })
    }

    const probe = (attempt: number) => {
      void api.info().then((res) => {
        if (cancelled) return
        if (res.available) {
          setLaunchAvailable(true, res.editors)
          timer = setTimeout(pollAvailability, AVAILABILITY_POLL_MS)
        } else if (attempt + 1 < PROBE_DELAYS_MS.length) {
          timer = setTimeout(() => probe(attempt + 1), PROBE_DELAYS_MS[attempt + 1])
        } else {
          setLaunchAvailable(false, [])
          // Keep polling slowly so enabling the plugin later in Plugin Manager activates live.
          timer = setTimeout(pollAvailability, AVAILABILITY_POLL_MS)
        }
      })
    }

    probe(0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [api])

  useEffect(() => {
    if (!available) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const syncRuns = async () => {
      const list = await api.listRuns()
      if (cancelled) return
      setRunsSnapshot(list)
      if (hasLiveRuns || consoleOpen) {
        timer = setTimeout(() => {
          void syncRuns()
        }, RUNS_POLL_MS)
      }
    }

    void syncRuns()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [api, available, hasLiveRuns, consoleOpen])

  if (!available || !consoleOpen) return null
  return (
    <Suspense fallback={null}>
      <LazyLaunchConsoleDrawer
        api={api}
        fontSize={fontSize}
        fontFamilyMono={fontFamilyMono}
        onOpenInTerminal={onOpenInTerminal}
      />
    </Suspense>
  )
}
