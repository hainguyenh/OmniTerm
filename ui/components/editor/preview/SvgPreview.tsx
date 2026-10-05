import { useEffect, useState } from 'react'

import { ImagePreview } from './ImagePreview'

/**
 * An SVG rendered from the editor's live text. Shown through `<img>`, where the browser runs no
 * script and loads no external resource from the document, so previewing an untrusted SVG is inert.
 */
export function SvgPreview({ text, fileName }: { text: string; fileName: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const next = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [text])

  // Keyed by URL so an edit that breaks the markup resets the "could not be decoded" state once fixed.
  return url ? <ImagePreview key={url} src={url} alt={fileName} sizeBytes={new Blob([text]).size} /> : null
}
