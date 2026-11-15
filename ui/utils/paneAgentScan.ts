import { invoke } from '@tauri-apps/api/core'

/**
 * One reading of which agent runs under each pane (`agent_quota_detect`, a walk of the OS process
 * table), shared by everything that asks: session persistence and Agent Quota both poll every few
 * seconds, and used to walk the table twice. A caller says how old a reading it accepts; requests
 * made while a walk is running wait for that walk instead of starting another.
 */

/** A reading this recent answers a routine poll (both pollers run every 5s). */
export const ROUTINE_SCAN_AGE_MS = 4_500

type Scan = () => Promise<unknown>

let scan: Scan = () => invoke<unknown>('agent_quota_detect')
let clock: () => number = () => Date.now()
let last: { at: number; rows: unknown } | null = null
let running: Promise<unknown> | null = null

/** The latest reading younger than `maxAgeMs` (0: none will do), walking the process table only when there is none. */
export function scanPaneAgents(maxAgeMs: number = ROUTINE_SCAN_AGE_MS): Promise<unknown> {
  if (running) return running
  if (last && clock() - last.at < maxAgeMs) return Promise.resolve(last.rows)
  const started = clock()
  const walk = scan().then(
    (rows) => {
      last = { at: started, rows }
      return rows
    },
  )
  running = walk
  // A failed walk is not remembered: the next caller tries again.
  void walk.finally(() => {
    if (running === walk) running = null
  }).catch(() => {})
  return walk
}

/** Test hook: a fake process-table walk and clock, and no remembered reading. */
export function resetPaneAgentScan(fake?: { scan?: Scan; now?: () => number }): void {
  scan = fake?.scan ?? (() => invoke<unknown>('agent_quota_detect'))
  clock = fake?.now ?? (() => Date.now())
  last = null
  running = null
}
