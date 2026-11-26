/**
 * How long until a profile's quota is read again.
 *
 * Extends the "smart" mode of the quota project (`core/monitor_engine.py::_calculate_next_interval`):
 * bands by how close usage is to the limit, a fast re-check after a sudden jump, plus two signals
 * that project lacked — the measured burn rate, which predicts when the limit will be crossed, and
 * whether any terminal on the profile is busy right now. A heavy task is polled often enough to
 * catch the limit before it is crossed; an idle profile is polled rarely, saving CLI launches and
 * API calls.
 */

export interface Sample {
  at: number
  usedPct: number
}

export const HISTORY_SIZE = 12
const BURN_WINDOW_MS = 15 * 60_000
/** %/min above which a profile counts as under heavy use. */
export const HEAVY_BURN = 0.5
/** A jump this big between two readings is treated as heavy use (the quota project's rule). */
export const SPIKE_POINTS = 6

const MIN_MS = 10_000
const MAX_MS = 600_000

export function pushSample(history: readonly Sample[], sample: Sample): Sample[] {
  const last = history[history.length - 1]
  // A reset shows up as usage dropping; the old history then says nothing about the new window.
  const base = last && sample.usedPct < last.usedPct - 1 ? [] : history
  return [...base, sample].slice(-HISTORY_SIZE)
}

/** Least-squares slope of usage over the last 15 minutes, in percent per minute. */
export function burnRate(history: readonly Sample[], now: number): number | null {
  const recent = history.filter((sample) => now - sample.at <= BURN_WINDOW_MS)
  if (recent.length < 2) return null
  const xs = recent.map((sample) => (sample.at - recent[0].at) / 60_000)
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length
  const meanY = recent.reduce((sum, sample) => sum + sample.usedPct, 0) / recent.length
  let numerator = 0
  let denominator = 0
  recent.forEach((sample, index) => {
    numerator += (xs[index] - meanX) * (sample.usedPct - meanY)
    denominator += (xs[index] - meanX) ** 2
  })
  return denominator === 0 ? null : numerator / denominator
}

export interface IntervalInput {
  history: readonly Sample[]
  /** Highest used/limit ratio across the profile's windows. */
  pressure: number
  /** Points of headroom left under the session limit. */
  headroom: number
  busy: boolean
  errorStreak: number
  now: number
  /** 0–1, injectable for tests; spreads probes so profiles do not fire in lockstep. */
  random?: () => number
}

function band(pressure: number): [number, number] {
  if (pressure >= 0.9) return [10_000, 15_000]
  if (pressure >= 0.85) return [25_000, 35_000]
  if (pressure >= 0.7) return [55_000, 70_000]
  return [140_000, 180_000]
}

export function nextInterval({ history, pressure, headroom, busy, errorStreak, now, random = Math.random }: IntervalInput): number {
  if (errorStreak > 0) return Math.min(300_000, 30_000 * 2 ** (errorStreak - 1))
  const [low, high] = band(pressure)
  let interval = low + (high - low) * random()
  const last = history[history.length - 1]
  const previous = history[history.length - 2]
  const rate = burnRate(history, now)
  const spiked = !!last && !!previous && last.usedPct - previous.usedPct >= SPIKE_POINTS
  const heavy = busy || spiked || (rate !== null && rate >= HEAVY_BURN)
  if (spiked) interval = Math.min(interval, 20_000)
  if (rate !== null && rate > 0) {
    // Check at least four times before the projected crossing.
    const eta = (Math.max(0, headroom) / rate) * 60_000
    interval = Math.min(interval, Math.max(MIN_MS, Math.min(300_000, eta / 4)))
  }
  if (!heavy) interval *= 2
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, interval)))
}

/**
 * A profile whose every agent is frozen cannot spend quota, so it is read slowly — at most every
 * five minutes — but a read always lands at its resume time, so the thaw and the wake are on time.
 */
export function heldInterval(resumeAt: number | undefined, now: number): number {
  if (resumeAt === undefined) return 120_000
  return Math.round(Math.min(300_000, Math.max(30_000, resumeAt - now)))
}

/** While guarding a freshly suspended agent, poll every 15–20 s regardless of history. */
export function guardInterval(random: () => number = Math.random): number {
  return Math.round(15_000 + 5_000 * random())
}
