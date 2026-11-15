import { diag } from '../../diag'
import { editorController, useTabs } from '../../ide/editor/core/controller'
import { activateTab, openTab, setActivePane, type TabsState } from '../../ide/editor/core/model/tabs'
import { useProject } from '../../ide/platform/project'
import { editorService, type EditorInput } from '../../ide/workbench/contributions'
import { selectedWorkspaceId, useWorkspaceStore } from '../../platform/workspaceStore'
import { SESSIONS_KIND } from '../sessionsHostCore'
import { isDocked, useTerminalDock } from '../terminalDock/terminalDockStore'

import { setLegacyLayout, useSessionBridge, type LegacyLayout, type SessionBridgeApi, type SessionInfo } from './sessionBridge'
import { closeTabSilently, isClosePending } from './sessionClose'
import { SESSION_KIND, parseSessionInput, sessionInput } from './sessionInput'
import { applyLegacyPlacement, planLegacyPlacement } from './sessionMigration'

/** The single "Sessions" tab of the old workbench, which session tabs replace. */
const LEGACY_KINDS: readonly string[] = [SESSIONS_KIND, 'sessions']
/** A split tab turns into a new shell; its session shows up within this time or the tab closes. */
const SPLIT_WAIT_MS = 15_000
const MAX_ROUNDS = 5

interface TabRef {
  paneId: string
  tabId: string
  input: EditorInput
}

/** Everything the reconciler touches, so tests can drive it without the editor and the shell. */
export interface ReconcilerHost {
  tabs(): TabsState
  setTabs(next: TabsState): void
  bridge(): {
    sessions: SessionInfo[]
    restoreSettled: boolean
    legacyLayout: LegacyLayout | null
    api: SessionBridgeApi | null
  }
  consumeLegacyLayout(): void
  /** The backend is opening a workspace as project: nothing is decided until it answered. */
  projectOpening(): boolean
  /** A project (folder workspace) is open; without one, tabs are not reset on a workspace switch. */
  hasProject(): boolean
  workspacesLoaded(): boolean
  selectedWorkspace(): string
  closeTab(paneId: string, tabId: string): Promise<boolean>
  closeTabSilently(sessionId: string): Promise<void>
  /** Opens (and shows) a session's tab. */
  openAndShow(input: EditorInput): Promise<void>
  isClosePending(sessionId: string): boolean
  /** The session lives in the Terminal tool window: it has no editor tab. */
  isDocked(sessionId: string): boolean
  now(): number
}

function collect(state: TabsState): TabRef[] {
  return Object.values(state.panes).flatMap((pane) => pane.tabs.map((tab) => ({ paneId: pane.id, tabId: tab.id, input: tab.input })))
}

/**
 * Keeps the editor's session tabs and the window's sessions in step. Runs only once the saved
 * sessions are restored and no project is being opened (the editor resets its tabs on a project
 * switch and restores the new project's own afterwards).
 *
 * - tabs of unknown sessions (another window's, or ended) close silently, never killing anything;
 * - the old single "Sessions" tab goes;
 * - a split / "open in opposite group" duplicate of a session tab becomes a new shell in the same folder;
 * - live sessions of the workspace shown that have no tab get one (the first time, from the old grid);
 * - with no project open, tabs of other workspaces' sessions close silently (their sessions keep running);
 * - a session docked in the Terminal tool window has no tab: one it still has closes silently.
 * A project switch closes nothing: sessions keep running, parked, and return with that project's tabs.
 */
export function createSessionTabsReconciler(host: ReconcilerHost) {
  let running = false
  let again = false
  let knownTabs: Set<string> | null = null
  let knownSessions: Set<string> | null = null
  let editorWorkspace = host.selectedWorkspace()
  /** Split duplicates waiting for their new shell; the tab is retargeted in place when it shows up. */
  let pendingSplits: { tabId: string; at: number }[] = []
  /** Sessions without a workspace stay with the workspace that was shown when they first appeared. */
  const homes = new Map<string, string>()

  const workspaceOf = (session: SessionInfo): string => {
    if (session.workspaceId) return session.workspaceId
    let home = homes.get(session.id)
    if (home === undefined) {
      home = editorWorkspace
      homes.set(session.id, home)
    }
    return home
  }

  /** Points a split duplicate at the session started for it, and shows it. False: the tab is gone. */
  function retarget(tabId: string, input: EditorInput): boolean {
    const state = host.tabs()
    const paneId = Object.keys(state.panes).find((id) => state.panes[id]!.tabs.some((tab) => tab.id === tabId))
    if (!paneId) return false
    const pane = state.panes[paneId]!
    const tabs = pane.tabs.map((tab) => (tab.id === tabId ? { ...tab, input } : tab))
    host.setTabs(activateTab(setActivePane({ ...state, panes: { ...state.panes, [paneId]: { ...pane, tabs } } }, paneId), paneId, tabId))
    return true
  }

  async function pass(): Promise<void> {
    const { sessions, restoreSettled, legacyLayout, api } = host.bridge()
    if (!restoreSettled || !api || host.projectOpening() || !host.workspacesLoaded()) return
    const live = new Map(sessions.map((session) => [session.id, session]))
    let acted = false

    for (const ref of collect(host.tabs())) {
      if (LEGACY_KINDS.includes(ref.input.kind)) {
        await host.closeTab(ref.paneId, ref.tabId)
        acted = true
      } else if (ref.input.kind === SESSION_KIND) {
        const id = parseSessionInput(ref.input)
        if (id === null) {
          await host.closeTab(ref.paneId, ref.tabId)
          acted = true
        } else if (!live.has(id) && !host.isClosePending(id)) {
          await host.closeTabSilently(id)
          acted = true
        }
      }
    }

    let refs = collect(host.tabs())
    const tabsOf = (id: string) => refs.filter((ref) => parseSessionInput(ref.input) === id)

    for (const session of sessions) {
      if (host.isDocked(session.id) && tabsOf(session.id).length > 0 && !host.isClosePending(session.id)) {
        await host.closeTabSilently(session.id)
        acted = true
      }
    }
    refs = collect(host.tabs())

    // A tab id seen for the first time on a key that is open elsewhere is a split duplicate.
    if (knownTabs) {
      for (const id of live.keys()) {
        const own = tabsOf(id)
        if (own.length < 2) continue
        for (const duplicate of own.filter((ref) => !knownTabs?.has(ref.tabId)).slice(0, own.length - 1)) {
          pendingSplits.push({ tabId: duplicate.tabId, at: host.now() })
          api.newSessionLike(id)
          acted = true
        }
      }
      refs = collect(host.tabs())
    }

    if (!host.hasProject()) {
      for (const session of sessions) {
        if (workspaceOf(session) !== editorWorkspace && tabsOf(session.id).length > 0 && !host.isClosePending(session.id)) {
          await host.closeTabSilently(session.id)
          acted = true
        }
      }
      refs = collect(host.tabs())
    }

    // A split whose new shell never came (it failed to start) closes its duplicate tab.
    for (const split of pendingSplits.filter((item) => host.now() - item.at >= SPLIT_WAIT_MS)) {
      const ref = collect(host.tabs()).find((item) => item.tabId === split.tabId)
      if (ref) await host.closeTab(ref.paneId, ref.tabId)
      acted = true
    }
    pendingSplits = pendingSplits.filter((item) => host.now() - item.at < SPLIT_WAIT_MS)

    const missing = sessions.filter(
      (session) =>
        workspaceOf(session) === editorWorkspace &&
        tabsOf(session.id).length === 0 &&
        !host.isClosePending(session.id) &&
        !host.isDocked(session.id),
    )
    if (missing.length > 0) {
      const sessionTabsOpen = refs.some((ref) => ref.input.kind === SESSION_KIND)
      const plan = !knownSessions && legacyLayout && !sessionTabsOpen
        ? planLegacyPlacement(legacyLayout, new Set(missing.map((session) => session.id)))
        : null
      const migrated = plan ? applyLegacyPlacement(host.tabs(), plan) : null
      if (migrated) host.setTabs(migrated)
      for (const session of missing) {
        if (migrated && plan?.assignments.some((item) => item.sessionId === session.id)) continue
        const input = sessionInput(session.id)
        // A session created after the start is shown; restored and returning ones stay in the background.
        const fresh = knownSessions !== null && !knownSessions.has(session.id)
        const split = fresh ? pendingSplits.shift() : undefined
        if (split && retarget(split.tabId, input)) continue
        if (fresh) await host.openAndShow(input)
        else host.setTabs(openTab(host.tabs(), host.tabs().activePane, input, { activate: false }).state)
      }
      acted = true
    }
    if (legacyLayout) host.consumeLegacyLayout()
    knownSessions = new Set([...(knownSessions ?? []), ...live.keys()])
    knownTabs = new Set(collect(host.tabs()).map((ref) => ref.tabId))
    if (acted) again = true
  }

  async function run(): Promise<void> {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      // Bounded: an action that cannot take effect must not spin forever.
      for (let round = 0; round < MAX_ROUNDS; round++) {
        again = false
        await pass()
        if (!again) break
      }
    } catch (error) {
      diag.warn('[sessions] reconciling the session tabs failed', error)
    } finally {
      running = false
    }
  }

  return {
    run,
    /** The workspace the editor's project belongs to: captured whenever a project open finishes. */
    projectSettled(): void {
      editorWorkspace = host.selectedWorkspace()
    },
  }
}

const workspaceKey = () => selectedWorkspaceId(useWorkspaceStore.getState().selection) ?? ''

function liveHost(): ReconcilerHost {
  return {
    tabs: () => useTabs.getState(),
    setTabs: (next) => useTabs.setState(next, true),
    bridge: () => useSessionBridge.getState(),
    consumeLegacyLayout: () => setLegacyLayout(null),
    projectOpening: () => useProject.getState().opening,
    hasProject: () => useProject.getState().project !== null || useProject.getState().lightEdit,
    workspacesLoaded: () => useWorkspaceStore.getState().loaded,
    selectedWorkspace: workspaceKey,
    closeTab: (paneId, tabId) => editorController().closeTab(paneId, tabId),
    closeTabSilently,
    openAndShow: (input) => editorService().openInput(input, { focus: true }),
    isClosePending,
    isDocked,
    now: () => Date.now(),
  }
}

/** Starts the reconciler against the live stores; returns its stop function. */
export function startSessionTabsReconciler(host: ReconcilerHost = liveHost()): () => void {
  const reconciler = createSessionTabsReconciler(host)
  let queued = false
  const schedule = () => {
    if (queued) return
    queued = true
    setTimeout(() => {
      queued = false
      void reconciler.run()
    }, 0)
  }
  const stops = [
    useTabs.subscribe(schedule),
    useSessionBridge.subscribe(schedule),
    useWorkspaceStore.subscribe(schedule),
    useTerminalDock.subscribe(schedule),
    useProject.subscribe((state) => {
      if (!state.opening) reconciler.projectSettled()
      schedule()
    }),
  ]
  schedule()
  return () => stops.forEach((stop) => stop())
}
