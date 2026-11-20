import { create } from 'zustand'

/** Live numbers of the window's sessions (latency, metrics, connect time) for the status bar. */
export interface SessionLiveState {
  latencies: Record<string, number | null>
  metrics: Record<string, SessionMetrics | undefined>
  connectedAt: Record<string, number | undefined>
}

export const useSessionLive = create<SessionLiveState>(() => ({ latencies: {}, metrics: {}, connectedAt: {} }))
