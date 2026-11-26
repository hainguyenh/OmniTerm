import { useCallback, useEffect, useState } from 'react'

import type { ClaudeBridgeResult, ClaudeBridgeStatus, ProfileRow } from './claudeBridgeAPI'

import { listAgentProfiles } from './agentQuotaAPI'
import { bridgeAgentName, bridgeLabel, bridgeRows, claudeBridge, rowKey } from './claudeBridgeAPI'
import { SubHeading } from './settingsControls'

type RowState = { status: ClaudeBridgeStatus | null; busy: boolean; error: string | null }

const BUTTON = 'px-2 py-0.5 rounded-lg border border-theme-border hover:border-theme-accent disabled:opacity-40'

/**
 * Settings › Agent Quota › status line bridges. In a Claude profile the bridge makes Claude Code
 * hand OmniTerm its `rate_limits` after every reply (fresher than `claude -p /usage`, and with no
 * CLI run) and adds a guard that refuses a new sub-agent once the 5-hour or weekly limit set above
 * is reached; in an Antigravity profile it keeps the `quota` the CLI hands its status line. Agent
 * Quota installs it by itself; Remove here keeps it out. Acts at once on the profile's
 * settings.json — it is not part of the Apply draft.
 */
export function ClaudeBridgeSettings() {
  const [rows, setRows] = useState<ProfileRow[] | null>(null)
  const [states, setStates] = useState<Record<string, RowState>>({})

  const settle = useCallback((key: string, result: ClaudeBridgeResult) => {
    setStates((prev) => ({
      ...prev,
      [key]: result.ok
        ? { status: result.status, busy: false, error: null }
        : { status: prev[key]?.status ?? null, busy: false, error: result.message },
    }))
  }, [])

  useEffect(() => {
    let live = true
    void listAgentProfiles().then((profiles) => {
      if (!live) return
      const found = bridgeRows(profiles)
      setRows(found)
      for (const row of found) {
        void claudeBridge('status', row.dir, row.agent).then((result) => {
          if (live) settle(rowKey(row), result)
        })
      }
    })
    return () => { live = false }
  }, [settle])

  const run = (row: ProfileRow, command: 'install' | 'remove') => {
    const key = rowKey(row)
    setStates((prev) => ({ ...prev, [key]: { status: prev[key]?.status ?? null, busy: true, error: null } }))
    void claudeBridge(command, row.dir, row.agent).then((result) => settle(key, result))
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-theme-border p-3 text-xs" aria-label="Status line bridges">
      <SubHeading hint="Claude Code and the Antigravity CLI pass their quota to the status line. OmniTerm keeps it per profile and shows your earlier status line unchanged; for Claude it also blocks the Agent/Task tool while a limit is reached. A reading older than 10 minutes is ignored and the agent's /usage is used again.">
        Status line bridges
      </SubHeading>
      <p className="text-[11px] text-theme-dim">
        Live quota from the agent itself, so OmniTerm never freezes a new agent pane or types /usage into it. Installed
        automatically the first time a profile is seen; Remove keeps it out. Changes the profile&apos;s settings.json (a
        backup is kept in its omniterm folder).
      </p>
      {rows === null && <span className="text-theme-dim">Looking for profiles…</span>}
      {rows?.length === 0 && <span className="text-theme-dim">No Claude or Antigravity profile folder found.</span>}
      {rows?.map((row) => {
        const state = states[rowKey(row)]
        const status = state?.status ?? null
        const busy = state?.busy ?? false
        return (
          <div key={rowKey(row)} className="flex items-center gap-2" data-testid={`${row.agent}-bridge-${row.name}`}>
            <span className="flex-1 min-w-0">
              <span className="font-semibold text-theme-fg">{row.name}</span>
              <span className="ml-1 text-[11px] text-theme-dim">{bridgeAgentName(row.agent)}</span>
              <span className="ml-1.5 text-[11px] text-theme-dim" title={row.dir}>{state?.error ?? bridgeLabel(status, row.agent)}</span>
            </span>
            {status && !status.unreadable && (!status.installed || !status.current) && (
              <button type="button" className={BUTTON} disabled={busy} onClick={() => run(row, 'install')}>
                {status.installed ? 'Update' : 'Install'}
              </button>
            )}
            {status?.installed && (
              <button type="button" className={BUTTON} disabled={busy} onClick={() => run(row, 'remove')}>
                Remove
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}
