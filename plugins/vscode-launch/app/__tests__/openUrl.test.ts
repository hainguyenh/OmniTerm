/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'

import type { LaunchConfigItem, LaunchRunSummary } from '../../src/types'
import { normalizeBrowserUrl, openExternalUrl, resolveBrowserUrl } from '../openUrl'
import type { VsCodeLaunchAPI } from '../vscodeLaunchAPI'

describe('openUrl helpers', () => {
  it('normalizes 0.0.0.0 to localhost', () => {
    expect(normalizeBrowserUrl('http://0.0.0.0:5173')).toBe('http://localhost:5173')
    expect(normalizeBrowserUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
  })

  it('resolves browser URL from run listeningUrls first, then cfg url, then port', () => {
    const run: LaunchRunSummary = {
      runId: 'r1',
      configId: 'c1',
      name: 'Web App',
      type: 'node',
      mode: 'run',
      status: 'running',
      rootDir: '/app',
      cwd: '/app',
      workspaceFolder: '/app',
      relativeFolder: '.',
      terminalCommand: 'npm run dev',
      startedAt: Date.now(),
      listeningUrls: ['http://0.0.0.0:5173/app'],
    }
    const cfg: LaunchConfigItem = {
      id: 'c1',
      name: 'Web App',
      type: 'node',
      request: 'launch',
      runnable: true,
      workspaceFolder: '/app',
      relativeFolder: '.',
      url: 'http://127.0.0.1:5173',
    }

    expect(resolveBrowserUrl(run, cfg)).toBe('http://localhost:5173/app')

    const runNoUrls: LaunchRunSummary = { ...run, listeningUrls: [] }
    expect(resolveBrowserUrl(runNoUrls, cfg)).toBe('http://127.0.0.1:5173')

    const cfgNoUrl: LaunchConfigItem = { ...cfg, url: undefined, port: 8080 }
    expect(resolveBrowserUrl(runNoUrls, cfgNoUrl)).toBe('http://localhost:8080')

    const runAttach: LaunchRunSummary = {
      ...runNoUrls,
      attach: { kind: 'generic', port: 9222 },
    }
    expect(resolveBrowserUrl(runAttach, { ...cfg, url: undefined, port: undefined })).toBe(
      'http://localhost:9222',
    )
  })

  it('opens external URL via window.open and plugin API', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const mockApi: Partial<VsCodeLaunchAPI> = {
      openUrl: vi.fn(async () => true),
    }

    const ok = await openExternalUrl('http://127.0.0.1:5173', mockApi as VsCodeLaunchAPI)
    expect(ok).toBe(true)
    expect(openSpy).toHaveBeenCalledWith('http://127.0.0.1:5173', '_blank', 'noopener,noreferrer')
    expect(mockApi.openUrl).toHaveBeenCalledWith('http://127.0.0.1:5173')

    // Refuses invalid non-http URL
    expect(await openExternalUrl('javascript:alert(1)')).toBe(false)
    openSpy.mockRestore()
  })

  it('prefers window.omnitermAPI.app.openUrl when present', async () => {
    const omnitermOpenUrl = vi.fn(async () => {})
    window.omnitermAPI = {
      app: { openUrl: omnitermOpenUrl },
    } as unknown as typeof window.omnitermAPI

    const ok = await openExternalUrl('http://0.0.0.0:5173')
    expect(ok).toBe(true)
    expect(omnitermOpenUrl).toHaveBeenCalledWith('http://localhost:5173')

    delete (window as { omnitermAPI?: unknown }).omnitermAPI
  })
})
