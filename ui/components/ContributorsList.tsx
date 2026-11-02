import React, { useEffect, useState } from 'react'
import { ExternalLink, GitFork } from 'lucide-react'

export interface Contributor {
  login: string
  id: number
  avatar_url: string
  html_url: string
  codeChanges?: number
  contributions?: number
}

const FALLBACK_CONTRIBUTORS: Contributor[] = [
  {
    login: 'the-long-ride',
    id: 73347418,
    avatar_url: 'https://avatars.githubusercontent.com/u/73347418?v=4',
    html_url: 'https://github.com/the-long-ride',
    codeChanges: 25000,
  },
  {
    login: 'hainguyenh',
    id: 8667952,
    avatar_url: 'https://avatars.githubusercontent.com/u/8667952?v=4',
    html_url: 'https://github.com/hainguyenh',
    codeChanges: 12000,
  },
]

interface StatsContributorItem {
  author?: {
    login?: string
    id?: number
    avatar_url?: string
    html_url?: string
  }
  total?: number
  weeks?: Array<{ a?: number; d?: number; c?: number }>
}

function parseStatsContributors(data: unknown): Contributor[] | null {
  if (!Array.isArray(data)) return null
  const parsed: Contributor[] = []
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as StatsContributorItem
    const author = item.author
    if (!author || typeof author.login !== 'string' || !author.login) continue
    const codeChanges = Array.isArray(item.weeks)
      ? item.weeks.reduce((sum, w) => sum + (w.a ?? 0) + (w.d ?? 0), 0)
      : 0
    parsed.push({
      login: author.login,
      id: typeof author.id === 'number' ? author.id : 0,
      avatar_url: typeof author.avatar_url === 'string' ? author.avatar_url : '',
      html_url: typeof author.html_url === 'string' ? author.html_url : '',
      codeChanges,
      contributions: typeof item.total === 'number' ? item.total : 0,
    })
  }
  return parsed.length > 0 ? parsed : null
}

const REPO_OWNER = 'hainguyenh'

function sortContributors(list: Contributor[]): Contributor[] {
  return [...list].sort((a, b) => {
    const isOwnerA = a.login.toLowerCase() === REPO_OWNER.toLowerCase()
    const isOwnerB = b.login.toLowerCase() === REPO_OWNER.toLowerCase()
    if (isOwnerA && !isOwnerB) return -1
    if (!isOwnerA && isOwnerB) return 1
    const diff = (b.codeChanges ?? 0) - (a.codeChanges ?? 0)
    if (diff !== 0) return diff
    return (b.contributions ?? 0) - (a.contributions ?? 0)
  })
}

export const ContributorsList: React.FC = () => {
  const [contributors, setContributors] = useState<Contributor[]>(() =>
    sortContributors(FALLBACK_CONTRIBUTORS),
  )

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    const loadContributors = async () => {
      try {
        const statsRes = await fetch('https://api.github.com/repos/hainguyenh/OmniTerm/stats/contributors', {
          signal: controller.signal,
          headers: { Accept: 'application/vnd.github.v3+json' },
        })

        if (statsRes.status === 200) {
          const statsData: unknown = await statsRes.json()
          const parsed = parseStatsContributors(statsData)
          if (parsed && active) {
            setContributors(sortContributors(parsed))
            return
          }
        }

        const fallbackRes = await fetch('https://api.github.com/repos/hainguyenh/OmniTerm/contributors', {
          signal: controller.signal,
          headers: { Accept: 'application/vnd.github.v3+json' },
        })

        if (!fallbackRes.ok) return
        const fallbackData: unknown = await fallbackRes.json()
        if (!active || !Array.isArray(fallbackData)) return

        const list: Contributor[] = fallbackData
          .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
          .map((item) => ({
            login: typeof item.login === 'string' ? item.login : '',
            id: typeof item.id === 'number' ? item.id : 0,
            avatar_url: typeof item.avatar_url === 'string' ? item.avatar_url : '',
            html_url: typeof item.html_url === 'string' ? item.html_url : '',
            contributions: typeof item.contributions === 'number' ? item.contributions : 0,
          }))
          .filter((c) => c.login && c.html_url)

        if (list.length > 0) {
          setContributors(sortContributors(list))
        }
      } catch {
        // Fallback contributors already populate the view when offline
      }
    }

    void loadContributors()

    return () => {
      active = false
      controller.abort()
    }
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <GitFork className="w-3.5 h-3.5 text-theme-accent" />
          <h3 className="text-xs font-bold text-theme-fg uppercase tracking-wider">Contributors</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="contributors-list">
        {contributors.map((c) => (
          <a
            key={c.id || c.login}
            href={c.html_url}
            target="_blank"
            rel="noreferrer noopener"
            data-testid={`contributor-card-${c.login}`}
            className="group flex items-center gap-3 p-2.5 rounded-xl bg-theme-bg/60 border border-theme-border hover:border-theme-accent hover:bg-[var(--theme-hover-bg)] transition-all"
            title={`View ${c.login} on GitHub`}
          >
            <img
              src={c.avatar_url}
              alt={c.login}
              className="w-9 h-9 rounded-full border border-theme-border/50 object-cover shrink-0 bg-theme-bg"
              loading="lazy"
            />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-bold text-theme-fg group-hover:text-theme-accent transition-colors truncate">
                {c.login}
              </span>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-theme-dim group-hover:text-theme-accent transition-colors shrink-0" />
          </a>
        ))}
      </div>
    </div>
  )
}

export default ContributorsList
