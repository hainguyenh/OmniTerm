import { create } from 'zustand'

import { commands, type ServerId, type ServerInfo, type ServerStatus } from '../../ide/bindings'
import { call, isTauri, onIdeEvent } from '../../ide/platform/ipc'

export type NormalizedLspStatus =
  | 'Idle'
  | 'Starting'
  | 'Ready'
  | 'Stopping'
  | 'Missing'
  | 'Failed'

export interface LspServerRecord {
  id: number
  name: string
  languages: string[]
  status: NormalizedLspStatus
  rawStatus: string
  message: string | null
  installHint: string | null
  pid?: number | null
}

export interface LspServersState {
  servers: Map<number, LspServerRecord>
  overallStatus: NormalizedLspStatus
  isRestarting: boolean

  setServer: (record: LspServerRecord) => void
  updateServerStatus: (
    server: number | string,
    status: NormalizedLspStatus | ServerStatus | string,
    message?: string | null,
    installHint?: string | null,
  ) => void
  removeServer: (id: number) => void
  refreshServers: () => Promise<void>
  restartServer: (serverId?: number) => Promise<void>
  reset: () => void
}

const DEFAULT_INSTALL_HINTS: Record<string, string> = {
  'rust-analyzer': 'rustup component add rust-analyzer',
  vtsls: 'npm install -g @vtsls/language-server typescript',
  'typescript-language-server': 'npm install -g typescript-language-server typescript',
  pyright: 'npm install -g pyright',
  basedpyright: 'pip install basedpyright',
  ruff: 'pip install ruff',
  gopls: 'go install golang.org/x/tools/gopls@latest',
  clangd: 'Install LLVM / Clang from your package manager',
}

export function normalizeStatus(raw: string): NormalizedLspStatus {
  const s = raw.toLowerCase()
  if (s === 'ready') return 'Ready'
  if (s === 'starting' || s === 'busy') return 'Starting'
  if (s === 'stopping' || s === 'stopped') return 'Stopping'
  if (s === 'missing') return 'Missing'
  if (s === 'crashed' || s === 'failed' || s === 'misconfigured') return 'Failed'
  return 'Idle'
}

function resolveInstallHint(name: string, message?: string | null): string | null {
  if (message && (message.includes('install') || message.includes('Install') || message.includes('rustup') || message.includes('npm'))) {
    return message
  }
  const key = Object.keys(DEFAULT_INSTALL_HINTS).find((k) => name.toLowerCase().includes(k))
  if (key) {
    return DEFAULT_INSTALL_HINTS[key]
  }
  return message ?? null
}

function computeOverallStatus(servers: Map<number, LspServerRecord>): NormalizedLspStatus {
  if (servers.size === 0) return 'Idle'
  const list = [...servers.values()]
  if (list.some((s) => s.status === 'Failed')) return 'Failed'
  if (list.some((s) => s.status === 'Missing')) return 'Missing'
  if (list.some((s) => s.status === 'Starting')) return 'Starting'
  if (list.some((s) => s.status === 'Ready')) return 'Ready'
  return 'Idle'
}

export const useLspServersStore = create<LspServersState>((set, get) => ({
  servers: new Map(),
  overallStatus: 'Idle',
  isRestarting: false,

  setServer: (record: LspServerRecord) => {
    const next = new Map(get().servers)
    next.set(record.id, record)
    set({
      servers: next,
      overallStatus: computeOverallStatus(next),
    })
  },

  updateServerStatus: (server, rawStatus, message = null, installHint = null) => {
    const next = new Map(get().servers)
    const norm = typeof rawStatus === 'string' ? normalizeStatus(rawStatus) : rawStatus

    let existingId: number | null = null
    let existingRecord: LspServerRecord | null = null

    if (typeof server === 'number') {
      existingId = server
      existingRecord = next.get(server) ?? null
    } else {
      for (const [id, rec] of next.entries()) {
        if (rec.name.toLowerCase() === server.toLowerCase()) {
          existingId = id
          existingRecord = rec
          break
        }
      }
    }

    const id = existingId ?? (typeof server === 'number' ? server : Date.now())
    const name = existingRecord?.name ?? (typeof server === 'string' ? server : `Server ${id}`)
    const hint = installHint ?? resolveInstallHint(name, message) ?? existingRecord?.installHint ?? null

    const updated: LspServerRecord = {
      id,
      name,
      languages: existingRecord?.languages ?? [],
      status: norm,
      rawStatus: String(rawStatus),
      message: message ?? existingRecord?.message ?? null,
      installHint: hint,
      pid: existingRecord?.pid ?? null,
    }

    next.set(id, updated)
    set({
      servers: next,
      overallStatus: computeOverallStatus(next),
    })
  },

  removeServer: (id: number) => {
    const next = new Map(get().servers)
    next.delete(id)
    set({
      servers: next,
      overallStatus: computeOverallStatus(next),
    })
  },

  refreshServers: async () => {
    try {
      if (isTauri() && typeof commands !== 'undefined' && typeof commands.lspServers === 'function') {
        const list = await call(commands.lspServers()) as ServerInfo[]
        if (Array.isArray(list)) {
          const next = new Map<number, LspServerRecord>()
          for (const info of list) {
            const norm = normalizeStatus(info.status)
            const hint = resolveInstallHint(info.name)
            next.set(info.id, {
              id: info.id,
              name: info.name,
              languages: info.languages,
              status: norm,
              rawStatus: info.status,
              message: null,
              installHint: hint,
              pid: info.pid,
            })
          }
          set({
            servers: next,
            overallStatus: computeOverallStatus(next),
          })
        }
      }
    } catch {
      // IPC or mock error handled gracefully
    }
  },

  restartServer: async (serverId?: number) => {
    set({ isRestarting: true })
    const { servers } = get()

    try {
      if (typeof serverId === 'number') {
        get().updateServerStatus(serverId, 'Starting')
        if (isTauri() && typeof commands !== 'undefined' && typeof commands.lspRestart === 'function') {
          await call(commands.lspRestart(serverId as ServerId)).catch(() => {})
        }
      } else {
        const ids = [...servers.keys()]
        for (const id of ids) {
          get().updateServerStatus(id, 'Starting')
          if (isTauri() && typeof commands !== 'undefined' && typeof commands.lspRestart === 'function') {
            await call(commands.lspRestart(id as ServerId)).catch(() => {})
          }
        }
      }
      if (isTauri()) {
        await get().refreshServers().catch(() => {})
      }
    } finally {
      set({ isRestarting: false })
    }
  },

  reset: () => {
    set({
      servers: new Map(),
      overallStatus: 'Idle',
      isRestarting: false,
    })
  },
}))

let lspEventsDisposer: (() => void) | null = null

export function initLspServersEvents(): () => void {
  if (lspEventsDisposer) return lspEventsDisposer

  const unlistenServer = onIdeEvent('languageServer', (e) => {
    useLspServersStore.getState().updateServerStatus(e.server, e.status, e.message)
  })

  const unlistenWarning = onIdeEvent('languageServerWarning', (e) => {
    useLspServersStore.getState().updateServerStatus(e.name, 'Missing', e.message, e.installTool)
  })

  const unlistenRemoved = onIdeEvent('languageServerRemoved', (e) => {
    useLspServersStore.getState().removeServer(e.server)
  })

  void useLspServersStore.getState().refreshServers()

  lspEventsDisposer = () => {
    unlistenServer()
    unlistenWarning()
    unlistenRemoved()
    lspEventsDisposer = null
  }

  return lspEventsDisposer
}

if (typeof window !== 'undefined' && isTauri()) {
  initLspServersEvents()
}
