import { Maximize, Minus, Plus, Scan } from 'lucide-react'
import { useState, type WheelEvent } from 'react'

import { formatBytes, stepZoom } from './imageZoom'
import './image-preview.css'

interface ImagePreviewProps {
  /** A `blob:` URL the owner created and revokes. */
  src: string
  alt: string
  /** Bytes on disk, shown beside the pixel size when known. */
  sizeBytes?: number
}

type Zoom = 'fit' | number

/**
 * One image on a checkerboard, fitted to the pane by default. GIFs animate because the browser
 * plays them; icons are usually tiny, so "fit" never scales an image *up* past its natural size.
 */
export function ImagePreview({ src, alt, sizeBytes }: ImagePreviewProps) {
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const scale = zoom === 'fit' ? 1 : zoom

  const zoomBy = (direction: 1 | -1) => setZoom((value) => stepZoom(value === 'fit' ? 1 : value, direction))
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 1 : -1)
  }

  if (failed) {
    return (
      <div className="image-preview-message" role="status">
        This image could not be decoded. The file may be damaged or in a format the viewer does not support.
      </div>
    )
  }

  const details = [
    natural ? `${natural.width} × ${natural.height}` : null,
    sizeBytes === undefined ? null : formatBytes(sizeBytes),
  ].filter(Boolean).join(' · ')

  return (
    <div className="image-preview">
      <div className="image-preview-toolbar" role="toolbar" aria-label="Image zoom">
        <span className="image-preview-details">{details}</span>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}><Minus /></button>
        <span className="image-preview-zoom" aria-live="polite">{zoom === 'fit' ? 'Fit' : `${Math.round(scale * 100)}%`}</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}><Plus /></button>
        <button type="button" aria-label="Fit to view" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}><Maximize /></button>
        <button type="button" aria-label="Actual size" aria-pressed={zoom === 1} onClick={() => setZoom(1)}><Scan /></button>
      </div>
      <div className={`image-preview-stage${zoom === 'fit' ? ' is-fit' : ''}`} onWheel={onWheel}>
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={zoom === 'fit' || !natural ? undefined : { width: natural.width * scale, height: natural.height * scale }}
          onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  )
}
