const RELEASES_URL = 'https://api.github.com/repos/hainguyenh/OmniTerm/releases/latest'

export interface ReleaseAsset {
  name: string
  browserDownloadUrl: string
}

export interface LatestRelease {
  tag: string
  name: string
  notes: string
  htmlUrl: string
  publishedAt: string | null
  assets: ReleaseAsset[]
}

export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`GitHub release is missing ${field}`)
  return value
}

function asAssets(value: unknown): ReleaseAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((asset) => {
    if (!asset || typeof asset !== 'object') return []
    const item = asset as Record<string, unknown>
    if (typeof item.name !== 'string' || typeof item.browser_download_url !== 'string') return []
    return [{ name: item.name, browserDownloadUrl: item.browser_download_url }]
  })
}

export function parseRelease(payload: unknown): LatestRelease {
  if (!payload || typeof payload !== 'object') throw new Error('GitHub returned an invalid release')
  const release = payload as Record<string, unknown>
  const tag = asString(release.tag_name, 'tag_name')
  if (!parseVersion(tag)) throw new Error(`GitHub release tag ${tag} is not a stable version`)
  return {
    tag,
    name: typeof release.name === 'string' && release.name.trim() ? release.name : tag,
    notes: typeof release.body === 'string' ? release.body : '',
    htmlUrl: asString(release.html_url, 'html_url'),
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
    assets: asAssets(release.assets),
  }
}

export function assetUrl(release: LatestRelease, pattern: RegExp): string | null {
  return release.assets.find((asset) => pattern.test(asset.name))?.browserDownloadUrl ?? null
}

export async function fetchLatestRelease(
  fetcher: typeof fetch = fetch,
): Promise<LatestRelease> {
  const response = await fetcher(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
  return parseRelease(await response.json() as unknown)
}

export const UPDATE_RELEASES_URL = RELEASES_URL

export function createUpdateAPI(getVersion: () => Promise<string>) {
  let state: UpdateState | null = null
  const listeners = new Set<(next: UpdateState) => void>()
  const skippedVersionKey = 'omniterm:skipped-update-version'
  const skippedVersion = () => {
    try { return window.localStorage.getItem(skippedVersionKey) } catch { return null }
  }
  const publish = (next: UpdateState) => {
    state = next
    listeners.forEach((listener) => listener(next))
    return next
  }
  const check = async (): Promise<UpdateState> => {
    const current = await getVersion()
    try {
      const release = await fetchLatestRelease()
      const latest = release.tag.replace(/^v/, '')
      const skipped = skippedVersion()
      const newer = compareVersions(latest, current) > 0
      return publish({
        current, latest, latestTag: release.tag, latestName: release.name, notes: release.notes,
        htmlUrl: release.htmlUrl, publishedAt: release.publishedAt,
        updateAvailable: newer && skipped !== latest, skippedVersion: skipped,
        lastCheckAt: Date.now(), error: null, checking: false, isPortable: false,
        portableAssetUrl: assetUrl(release, /portable.*\.(zip|exe)$/i),
        installerAssetUrl: assetUrl(release, /(setup|installer).*\.exe$/i),
        downloadProgress: null, downloadStatus: null, hasNewerVersion: newer,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reach GitHub Releases'
      const previous = await stateOrDefault()
      publish({ ...previous, current, error: message, checking: false, lastCheckAt: Date.now() })
      throw error
    }
  }
  const stateOrDefault = async (): Promise<UpdateState> => state ?? {
    current: await getVersion(), latest: null, latestTag: null, latestName: '', notes: '', htmlUrl: '',
    publishedAt: null, updateAvailable: false, skippedVersion: skippedVersion(), lastCheckAt: null,
    error: null, checking: false, isPortable: false, portableAssetUrl: null, installerAssetUrl: null,
    downloadProgress: null, downloadStatus: null, hasNewerVersion: false,
  }
  return {
    check,
    state: stateOrDefault,
    skip: async (version: string | null) => {
      try {
        if (version) window.localStorage.setItem(skippedVersionKey, version)
        else window.localStorage.removeItem(skippedVersionKey)
      } catch { /* storage is optional */ }
      const current = await stateOrDefault()
      return publish({
        ...current,
        skippedVersion: version,
        updateAvailable: !!current.latest && compareVersions(current.latest, current.current) > 0 && current.latest !== version,
      })
    },
    getVersion,
    showSaveDialog: (_defaultName: string) => Promise.resolve(null),
    downloadPortable: (_savePath: string) => Promise.resolve(),
    downloadInstaller: (_installNow: boolean) => Promise.resolve(),
    onState: (listener: (next: UpdateState) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
