import { useCallback, useEffect, useState } from 'react'

function storageKeyFor(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').toLowerCase()
  return `omniterm:git-favorites:${normalized}`
}

function readFavorites(cwd: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKeyFor(cwd))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function useGitFavorites(cwd: string) {
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites(cwd))

  useEffect(() => {
    setFavorites(readFavorites(cwd))
  }, [cwd])

  useEffect(() => {
    const handleStorage = (event: StorageEvent | CustomEvent<{ cwd: string }>) => {
      if ('key' in event && event.key !== storageKeyFor(cwd)) return
      if ('detail' in event && event.detail?.cwd && storageKeyFor(event.detail.cwd) !== storageKeyFor(cwd)) return
      setFavorites(readFavorites(cwd))
    }

    window.addEventListener('storage', handleStorage as EventListener)
    window.addEventListener('omniterm:git-favorites-changed', handleStorage as EventListener)
    return () => {
      window.removeEventListener('storage', handleStorage as EventListener)
      window.removeEventListener('omniterm:git-favorites-changed', handleStorage as EventListener)
    }
  }, [cwd])

  const toggleFavorite = useCallback((branchName: string) => {
    setFavorites((prev) => {
      const exists = prev.includes(branchName)
      const next = exists ? prev.filter((b) => b !== branchName) : [...prev, branchName]
      try {
        localStorage.setItem(storageKeyFor(cwd), JSON.stringify(next))
        window.dispatchEvent(new CustomEvent('omniterm:git-favorites-changed', { detail: { cwd } }))
      } catch {
        // Local storage can be disabled or full
      }
      return next
    })
  }, [cwd])

  const isFavorite = useCallback((branchName: string) => favorites.includes(branchName), [favorites])

  return { favorites, isFavorite, toggleFavorite }
}
