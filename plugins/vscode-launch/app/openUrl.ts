import type { LaunchConfigItem, LaunchRunMode, LaunchRunStatus, LaunchRunSummary } from '../src/types'
import type { VsCodeLaunchAPI } from './vscodeLaunchAPI'

export function statusDotClass(status: LaunchRunStatus, mode: LaunchRunMode): string {
  if (status === 'starting') return 'bg-theme-warning animate-pulse'
  if (status === 'running') return mode === 'debug' ? 'bg-theme-warning' : 'bg-theme-success'
  if (status === 'failed') return 'bg-theme-error'
  return 'bg-theme-dim/50'
}

export async function writeClipboardText(text: string): Promise<void> {
  if (window.omnitermAPI?.clipboard?.writeText) {
    await window.omnitermAPI.clipboard.writeText(text)
    return
  }
  await navigator.clipboard?.writeText?.(text)
}

export function normalizeBrowserUrl(url: string): string {
  return url.replace('://0.0.0.0:', '://localhost:')
}

export function resolveBrowserUrl(
  run?: LaunchRunSummary,
  cfg?: LaunchConfigItem,
): string | null {
  if (run?.listeningUrls && run.listeningUrls.length > 0) {
    return normalizeBrowserUrl(run.listeningUrls[0])
  }
  if (cfg?.url) {
    return normalizeBrowserUrl(cfg.url)
  }
  if (run?.attach?.kind === 'generic' && run.attach.port) {
    return `http://localhost:${run.attach.port}`
  }
  if (cfg?.port) {
    return `http://localhost:${cfg.port}`
  }
  return null
}

export async function openExternalUrl(
  url: string,
  api?: VsCodeLaunchAPI | null,
): Promise<boolean> {
  const normalized = normalizeBrowserUrl(url.trim())
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }
  } catch {
    return false
  }

  // 1. Direct native app API (Tauri opener in OmniTerm)
  if (window.omnitermAPI?.app?.openUrl) {
    try {
      await window.omnitermAPI.app.openUrl(normalized)
      return true
    } catch {
      // Fall through to browser/plugin fallbacks
    }
  }

  try {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(normalized, '_blank', 'noopener,noreferrer')
    }
  } catch {
    // webview window.open fallback handled by backend call below
  }

  if (api?.openUrl) {
    try {
      await api.openUrl(normalized)
    } catch {
      // Non-fatal if already handled
    }
  }
  return true
}
