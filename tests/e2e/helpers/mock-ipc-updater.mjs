/**
 * Auto-Update Mock IPC Handlers & State Management.
 * Implements genuine contracts for Features 35-39 matching update_manager.rs and updates.rs.
 */

export function registerAutoUpdateHandlers(ipc) {
  ipc.isInstalling = false
  ipc.isRestarting = false
  ipc.announcedVersions = new Set()

  ipc.register('app_check_update', async (payload) => {
    if (payload?.simulateFailure) {
      throw new Error('Http500ServerError')
    }
    if (payload?.allEndpointsFailed || payload?.exhaustSources) {
      throw new Error('UpdateSourcesExhaustedError: all fallback endpoints failed')
    }
    if (payload?.certExpired) {
      throw new Error('TlsCertificateExpiredError: certificate expired')
    }
    if (payload?.customUrl) {
      if (!payload.customUrl.startsWith('https://')) {
        throw new Error('InvalidEndpointError: custom enterprise endpoint must use HTTPS')
      }
      return { available: true, version: '0.2.0', source: payload.customUrl }
    }
    let notes = payload?.releaseNotes ?? 'Fixed LSP and project tree'
    if (typeof notes === 'string') {
      notes = notes.replace(/<script[\s\S]*?<\/script>/gi, '')
    }
    const source = payload?.fallbackOnError || payload?.source === 'github_failed'
      ? 'cnb_endpoint'
      : (payload?.source || payload?.endpoint || 'github')
    return {
      available: true,
      version: '0.2.0',
      currentVersion: '0.1.14',
      releaseNotes: notes,
      source,
    }
  })

  ipc.register('app_install_update', async (payload) => {
    if (ipc.isInstalling && !payload?.force) {
      throw new Error('InstallingGuard: Another update installation is already in progress')
    }
    if (payload?.packageSize === 0) {
      ipc.isInstalling = false
      throw new Error('InvalidPackageError: update package size cannot be 0 bytes')
    }
    if (payload?.cancelledBeforeStart) {
      ipc.isInstalling = false
      return { status: 'cancelled', downloaded: 0 }
    }
    if (payload?.manifestHash && payload?.actualHash && payload.manifestHash !== payload.actualHash) {
      ipc.isInstalling = false
      throw new Error('ChecksumMismatchError: package verification failed')
    }
    if (payload?.simulateNetworkError) {
      if (payload?.channel) {
        payload.channel.send({ state: 'downloading', downloaded: 25, total: 100 })
      }
      ipc.isInstalling = false
      throw new Error('DownloadNetworkError: connection closed by peer')
    }

    ipc.isInstalling = true
    if (payload?.channel) {
      if (payload?.chunkDelayMs) {
        payload.channel.send({ state: 'downloading', downloaded: 20, total: 100 })
        await new Promise((r) => setTimeout(r, payload.chunkDelayMs))
        payload.channel.send({ state: 'downloading', downloaded: 60, total: 100 })
      } else {
        payload.channel.send({ state: 'downloading', downloaded: 50, total: 100 })
        payload.channel.send({ state: 'downloading', downloaded: 100, total: 100 })
      }
      payload.channel.send({ state: 'ready' })
    }
    return { status: 'started' }
  })

  ipc.register('app_cancel_update', async (payload) => {
    ipc.isInstalling = false
    return { token: payload?.token, cancelled: true, purged: true }
  })

  ipc.register('app_restart', async () => {
    if (ipc.isRestarting) {
      return { restarting: false, duplicate: true }
    }
    ipc.isRestarting = true
    return { restarting: true }
  })

  ipc.register('app_update_announcement', async (payload) => {
    const version = payload?.version || ''
    const automatic = payload?.automatic ?? true
    const claimed = !ipc.announcedVersions.has(version)
    if (claimed && version) {
      ipc.announcedVersions.add(version)
    }
    return !automatic || claimed
  })

  ipc.register('app_update_window_ready', async (payload) => ({
    ready: payload?.ready ?? true,
    systemLocale: payload?.systemLocale || 'en-US',
  }))
}
