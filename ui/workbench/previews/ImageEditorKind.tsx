import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ImagePreview } from '../../components/editor/preview/ImagePreview'
import { PreviewMessage } from '../../components/editor/preview/PreviewMessage'
import { call, commands } from '../../ide/platform/ipc'
import { basename } from '../../ide/platform/project'
import type { EditorInput } from '../../ide/workbench/contributions'

export function ImageEditorKind({ input }: { input: EditorInput }) {
  const path = input.path ?? ''
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    call(commands.fsReadImage(path))
      .then((dataUrl) => {
        if (active) {
          setUrl(dataUrl)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [path])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--theme-dim)]">
        <Loader2 className="w-5 h-5 animate-spin" aria-label="Loading" />
      </div>
    )
  }
  if (error || !url) {
    return <PreviewMessage text={error ?? 'Failed to load image.'} />
  }
  return <ImagePreview src={url} alt={basename(path)} />
}
