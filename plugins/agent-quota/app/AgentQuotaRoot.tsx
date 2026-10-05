import { useEffect, useRef } from 'react'

import type { AgentKind } from '../src/types'
import type { AgentQuotaAPI } from './agentQuotaAPI'
import type { QuotaConfig } from './quotaConfig'

import { diag } from '../../../ui/diag'
import { onAgentLaunch } from '../../../ui/utils/agentLaunchSignal'
import { readPaneScreen } from '../../../ui/utils/paneScreens'
import { setDashboardOpen, useProfileDashboard } from './profileDashboard'
import { clearOverrides, getQuotaState, registerQuotaCommands, setQuickOpen, updateQuota, useQuota } from './quotaStore'
import { parseQuotaConfig } from './quotaConfig'
import { QuotaEngine } from './quotaEngine'
import { holdForLaunch, LIVE_PROBE_IO, probeUsageInline, releaseLaunchHold } from './inlineUsageProbe'
import { clearAllResumeRecovery } from './resumeRecovery'
import { DangerConfirmDialog, QuotaNotices } from './QuotaOverlays'
import { QuotaProfilesDashboard } from './QuotaProfilesDashboard'
import { QuotaQuickPopover } from './QuotaQuickPopover'
import { FrozenProcessesDialog } from './FrozenProcessesDialog'

export interface AgentQuotaRootProps {
  api: AgentQuotaAPI
  appSettings: AppSettings
  setAppSettings: (settings: AppSettings) => void
  sessionIds: readonly string[]
  busy: Readonly<Record<string, boolean>>
  openSettings: () => void
}

/** The sidecar launches asynchronously, so presence is probed with back-off (as useBlurPlugin does). */
const PROBE_DELAYS = [0, 500, 1_000, 2_000, 4_000]
/**
 * Once present, re-checked on this slower cadence so the icon, engine, and any frozen agent all
 * follow the Plugin Manager immediately: enabling brings monitoring back, disabling stops the
 * engine and thaws everything it froze, instead of requiring a full app restart either way.
 */
const AVAILABILITY_POLL_MS = 5_000

/** Window event the `agentQuota` shortcut dispatches to toggle quick settings. */
export const QUICK_SETTINGS_EVENT = 'omniterm:agent-quota'
/** Asks the settings modal to show the Agent Quota tab. */
export const SETTINGS_TAB_EVENT = 'omniterm:settings-tab'

const isMonitoredAgent = (agent: string): agent is AgentKind => agent === 'claude' || agent === 'codex' || agent === 'agy'

/**
 * Mounted once in the main window. Probes for the plugin, feeds the global configuration into the
 * quota store, runs the engine while the plugin is present, and renders the window-level surfaces.
 */
export function AgentQuotaRoot({ api, appSettings, setAppSettings, sessionIds, busy, openSettings }: AgentQuotaRootProps) {
  const available = useQuota((state) => state.available)
  const quickOpen = useQuota((state) => state.quickOpen)
  const dashboardOpen = useProfileDashboard((state) => state.open)
  const engineRef = useRef<QuotaEngine | null>(null)
  const latest = useRef({ appSettings, setAppSettings, openSettings })
  latest.current = { appSettings, setAppSettings, openSettings }

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const setAvailable = (present: boolean) => {
      if (getQuotaState().available === present) return
      updateQuota((state) => ({ ...state, available: present }))
    }
    // Once present, keep checking on the slow cadence — this is what notices the Plugin Manager
    // disabling (or re-enabling) the plugin without requiring the user to restart the app.
    const pollWhilePresent = () => {
      void api.info().then((present) => {
        if (cancelled) return
        setAvailable(present)
        timer = setTimeout(pollWhilePresent, AVAILABILITY_POLL_MS)
      })
    }
    const probe = (attempt: number) => {
      void api.info().then((present) => {
        if (cancelled) return
        if (present) {
          setAvailable(true)
          timer = setTimeout(pollWhilePresent, AVAILABILITY_POLL_MS)
        } else if (attempt + 1 < PROBE_DELAYS.length) {
          timer = setTimeout(() => probe(attempt + 1), PROBE_DELAYS[attempt + 1])
        }
      })
    }
    probe(0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [api])

  const rawConfig = appSettings.agentQuota
  useEffect(() => {
    const config = parseQuotaConfig(rawConfig)
    updateQuota((state) => ({ ...state, config }))
  }, [rawConfig])

  useEffect(() => {
    if (!available) return
    const engine = new QuotaEngine({
      api,
      now: () => Date.now(),
      random: Math.random,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      inlineProbe: (terminal) => probeUsageInline(terminal, LIVE_PROBE_IO),
      launchHold: { hold: (sessionId) => holdForLaunch(sessionId), release: (sessionId) => releaseLaunchHold(sessionId) },
      readScreen: readPaneScreen,
    })
    engineRef.current = engine
    const stopLaunchWatch = onAgentLaunch((sessionId, agent) => {
      if (isMonitoredAgent(agent)) engine.noteLaunch(sessionId, agent)
    })
    const unregister = registerQuotaCommands({
      saveConfig: (config: QuotaConfig) => {
        const { appSettings: current, setAppSettings: set } = latest.current
        set({ ...current, agentQuota: config })
        void window.omnitermAPI.settings.save({ agentQuota: config })
      },
      refresh: (profileKey) => engine.refresh(profileKey),
      wake: (target) => engine.wake(target),
      suspend: (sessionId) => engine.suspend(sessionId),
      resume: (sessionId) => engine.resume(sessionId),
      resumeAll: () => engine.resumeAll(),
      readUsage: (sessionId) => engine.readUsage(sessionId),
      cancelUsageRead: (sessionId) => engine.cancelUsageRead(sessionId),
      recordReading: (profileKey, snapshot) => engine.recordReading(profileKey, snapshot),
      openSettings: () => {
        setQuickOpen(false)
        latest.current.openSettings()
        window.dispatchEvent(new CustomEvent(SETTINGS_TAB_EVENT, { detail: { tab: 'quota' } }))
      },
    })
    engine.start()
    return () => {
      stopLaunchWatch()
      engine.stop()
      unregister()
      engineRef.current = null
      clearOverrides()
      clearAllResumeRecovery()
      // Leaving (plugin disabled, window closing): nothing may stay frozen without a guard to thaw it.
      void api.resumeAll().catch((error: unknown) => diag.error('[agentQuota] resume-all on shutdown failed', error))
    }
  }, [available, api])

  useEffect(() => {
    engineRef.current?.setInputs({ sessionIds, busy })
  }, [sessionIds, busy, available])

  useEffect(() => {
    const toggle = () => {
      if (getQuotaState().available) setQuickOpen(!getQuotaState().quickOpen)
    }
    window.addEventListener(QUICK_SETTINGS_EVENT, toggle)
    return () => window.removeEventListener(QUICK_SETTINGS_EVENT, toggle)
  }, [])

  // The dashboard belongs to the plugin: it closes with it rather than reopening stale later.
  useEffect(() => {
    if (!available) setDashboardOpen(false)
  }, [available])

  if (!available) return null
  return (
    <>
      {quickOpen && <QuotaQuickPopover />}
      {dashboardOpen && <QuotaProfilesDashboard />}
      <FrozenProcessesDialog />
      <DangerConfirmDialog />
      <QuotaNotices />
    </>
  )
}
