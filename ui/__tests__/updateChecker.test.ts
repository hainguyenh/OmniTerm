import { describe, expect, it, vi } from 'vitest'
import {
  assetUrl,
  compareVersions,
  createUpdateAPI,
  fetchLatestRelease,
  parseRelease,
  parseVersion,
} from '../updateChecker'

describe('update checker', () => {
  it('parses stable GitHub tags and rejects prereleases', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion(' 1.2.3 ')).toEqual([1, 2, 3])
    expect(parseVersion('v1.2')).toBeNull()
    expect(parseVersion('v1.2.3-rc.1')).toBeNull()
  })

  it('compares numeric versions instead of lexical strings', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.2', 'v0.1.2')).toBe(0)
    expect(compareVersions('0.1.1', '0.1.2')).toBeLessThan(0)
  })

  it('normalizes the release payload and finds portable and installer assets', () => {
    const release = parseRelease({
      tag_name: 'v0.2.0',
      name: 'OmniTerm 0.2.0',
      body: 'Bug fixes',
      html_url: 'https://github.com/hainguyenh/OmniTerm/releases/tag/v0.2.0',
      published_at: '2026-08-12T00:00:00Z',
      assets: [
        { name: 'OmniTerm-portable.zip', browser_download_url: 'https://example.test/portable.zip' },
        { name: 'OmniTerm-setup.exe', browser_download_url: 'https://example.test/setup.exe' },
      ],
    })
    expect(assetUrl(release, /portable.*\.zip$/i)).toBe('https://example.test/portable.zip')
    expect(assetUrl(release, /(setup|installer).*\.exe$/i)).toBe('https://example.test/setup.exe')
  })

  it('requests the latest release through the GitHub API and surfaces HTTP failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v0.2.0',
      html_url: 'https://example.test/release',
      assets: [],
    }), { status: 200 }))
    await expect(fetchLatestRelease(fetcher)).resolves.toMatchObject({ tag: 'v0.2.0' })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/hainguyenh/OmniTerm/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' } },
    )

    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    await expect(fetchLatestRelease(failed)).rejects.toThrow('HTTP 503')
  })

  it('reports a newer release and keeps an error state when the check fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v0.2.0', html_url: 'https://example.test/release', assets: [],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const updates = createUpdateAPI(async () => '0.1.2')
    const listener = vi.fn()
    updates.onState(listener)
    await expect(updates.check()).resolves.toMatchObject({ updateAvailable: true, hasNewerVersion: true })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ latest: '0.2.0' }))

    fetcher.mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(updates.check()).rejects.toThrow('HTTP 503')
    await expect(updates.state()).resolves.toMatchObject({ error: 'GitHub returned HTTP 503' })
    vi.unstubAllGlobals()
  })
})
