/**
 * Pinned agent workspaces: a profile + folder pair the user wants one click away in the Bookmarks
 * view — "open claude-work in D:\repo" — independent of any particular session.
 *
 * Like stored sessions, a pin is validated on every load: it only ever names a launcher shape the
 * detector accepts and a plain folder path, so a forged entry cannot become an arbitrary command.
 */
import { useSyncExternalStore } from 'react'
import { isValidLauncher } from './agentSessionDetector'
import { registerDurableSlice, scheduleDurableSave } from './agentSessionDurable'
import type { AgentBrand } from '../../plugins/agent-quota/app/agentBrand'

const VALID_AGENTS = new Set<string>(['claude', 'codex', 'agy', 'opencode', 'copilot', 'gemini'])

export interface AgentWorkspacePin {
  /** `<profileName>|<cwd lower-cased>` — one pin per profile and folder. */
  id: string
  agent: AgentBrand
  profileName: string
  launcher?: string
  cwd: string
  folderName?: string
  createdAt: number
}

const STORAGE_KEY = 'omniterm:agent-workspace-pins'
const CHANGE_EVENT = 'omniterm:agent-workspace-pins-changed'
const MAX_PINS = 50

let memoryStore: AgentWorkspacePin[] = []
let cache: AgentWorkspacePin[] | null = null

export function pinIdFor(profileName: string, cwd: string): string {
  return `${profileName}|${cwd.replace(/[\\/]+$/, '').toLowerCase()}`
}

function isValidPin(item: unknown): item is AgentWorkspacePin {
  if (!item || typeof item !== 'object') return false
  const p = item as Record<string, unknown>
  return typeof p.id === 'string'
    && typeof p.agent === 'string' && VALID_AGENTS.has(p.agent)
    && typeof p.profileName === 'string' && p.profileName.trim().length > 0
    && typeof p.cwd === 'string' && p.cwd.trim().length > 0
    && typeof p.createdAt === 'number' && Number.isFinite(p.createdAt)
    && (p.launcher === undefined || isValidLauncher(p.launcher))
    && (p.folderName === undefined || typeof p.folderName === 'string')
}

export function loadPins(): AgentWorkspacePin[] {
  if (cache !== null) return cache
  if (typeof localStorage === 'undefined') {
    cache = memoryStore
    return cache
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    cache = Array.isArray(parsed) ? parsed.filter(isValidPin) : []
  } catch {
    cache = []
  }
  return cache
}

function persist(pins: AgentWorkspacePin[]): void {
  const capped = [...pins].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PINS)
  memoryStore = capped
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
    } catch {
      // Storage quota or unavailable — memory still has this tick's value.
    }
  }
  cache = null
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  scheduleDurableSave()
}

export function togglePin(pin: Omit<AgentWorkspacePin, 'id' | 'createdAt'>): void {
  const id = pinIdFor(pin.profileName, pin.cwd)
  const current = loadPins()
  if (current.some(item => item.id === id)) {
    persist(current.filter(item => item.id !== id))
    return
  }
  persist([...current, { ...pin, id, createdAt: Date.now() }])
}

export function removePin(id: string): void {
  const current = loadPins()
  const next = current.filter(item => item.id !== id)
  if (next.length !== current.length) persist(next)
}

export function clearPins(): void {
  persist([])
}

function hydrateFromFile(items: unknown[]): void {
  const current = loadPins()
  const ids = new Set(current.map(item => item.id))
  const added = items.filter(isValidPin).filter(item => !ids.has(item.id))
  if (added.length > 0) persist([...current, ...added])
}

registerDurableSlice('pins', { read: () => loadPins(), hydrate: hydrateFromFile })

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGE_EVENT, callback)
  return () => window.removeEventListener(CHANGE_EVENT, callback)
}

export function usePins(): AgentWorkspacePin[] {
  return useSyncExternalStore(subscribe, loadPins, () => [])
}
