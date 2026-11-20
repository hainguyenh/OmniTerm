import { useCallback, useEffect, useState } from 'react'

import type { TempNoteMeta } from '../../tempNotesAPI'

/** The temporary (sticky) notes on disk, reloaded whenever any note is created, saved or deleted. */
export function useTempNotesList(): { notes: TempNoteMeta[]; loading: boolean; reload: () => void } {
  const [notes, setNotes] = useState<TempNoteMeta[]>([])
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    window.omnitermAPI?.tempNotes
      ?.list()
      .then((data) => setNotes(data))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    reload()
    window.addEventListener('omniterm:temp-notes-changed', reload)
    return () => window.removeEventListener('omniterm:temp-notes-changed', reload)
  }, [reload])

  return { notes, loading, reload }
}

/** The Sticky Notes stripe badge: how many notes exist, null for none. */
export function useStickyNotesBadge(): number | null {
  const { notes } = useTempNotesList()
  return notes.length > 0 ? notes.length : null
}
