import { diag } from '../diag'

/**
 * The terminal's Ctrl+C rules (Settings › Tools › Terminal), stored as one `terminalCtrlC` object in
 * the app settings. The settings file is user-editable, so every field is validated and clamped on
 * read; anything missing or malformed falls back to the long-standing defaults below.
 */
export interface CtrlCSettings {
  /** Ctrl+C while text is selected: copy it, or send the interrupt anyway. */
  withSelection: 'copy' | 'interrupt'
  /** A second Ctrl+C inside `windowMs`: close the session, or only interrupt again. */
  doublePress: 'close' | 'none'
  /** How close two presses must be to count as a double press. */
  windowMs: number
  /** A process that exits this soon after a single Ctrl+C keeps its tab (with a restart line). */
  keepTabSeconds: number
  /** Show the "Press Ctrl+C again to close" hint after a lone Ctrl+C. */
  showHint: boolean
}

export const DEFAULT_CTRL_C: Readonly<CtrlCSettings> = {
  withSelection: 'copy',
  doublePress: 'close',
  windowMs: 500,
  keepTabSeconds: 3,
  showHint: true,
}

export const CTRL_C_LIMITS = {
  windowMs: { min: 200, max: 2000 },
  keepTabSeconds: { min: 0, max: 30 },
} as const

const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

export function parseCtrlCSettings(raw: unknown): CtrlCSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    withSelection: source.withSelection === 'interrupt' ? 'interrupt' : 'copy',
    doublePress: source.doublePress === 'none' ? 'none' : 'close',
    windowMs: clamp(source.windowMs, CTRL_C_LIMITS.windowMs, DEFAULT_CTRL_C.windowMs),
    keepTabSeconds: clamp(source.keepTabSeconds, CTRL_C_LIMITS.keepTabSeconds, DEFAULT_CTRL_C.keepTabSeconds),
    showHint: typeof source.showHint === 'boolean' ? source.showHint : DEFAULT_CTRL_C.showHint,
  }
}

let current: CtrlCSettings = { ...DEFAULT_CTRL_C }
let syncing = false

/** The rules in effect in this window. */
export function ctrlCSettings(): Readonly<CtrlCSettings> {
  return current
}

/** Applies a stored `terminalCtrlC` value (validated). */
export function setCtrlCSettings(raw: unknown): void {
  current = parseCtrlCSettings(raw)
}

/**
 * Follows the stored rules in this window: reads them once and then on every settings broadcast, so
 * a change made in the Settings window applies to open terminals at once. Idempotent.
 */
export function syncCtrlCSettings(): void {
  if (syncing) return
  const api = typeof window === 'undefined' ? undefined : window.omnitermAPI?.settings
  if (!api?.get) return
  syncing = true
  Promise.resolve(api.get())
    .then((settings: AppSettings | null | undefined) => setCtrlCSettings(settings?.terminalCtrlC))
    .catch((error: unknown) => diag.warn('[terminal] could not read the Ctrl+C settings', error))
  try {
    api.onChanged?.((settings) => setCtrlCSettings(settings?.terminalCtrlC))
  } catch (error) {
    diag.warn('[terminal] could not follow the Ctrl+C settings', error)
  }
}
