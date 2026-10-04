import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { WorkspaceScript } from '@omniterm/contract'

import { rasterImageMime } from '../../utils/imageFile'
import { FileEditorHeader } from './FileEditorHeader'
import { ImagePreview } from './preview/ImagePreview'
import { PreviewMessage } from './preview/PreviewMessage'
import './editor.css'
import './editor-chrome.css'

export interface ImageFileTabProps {
  workspaceId: string
  script: WorkspaceScript
  visible: boolean
  onClose: () => void
}

type ImageState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; url: string; size: number }
  | { status: 'error'; message: string }

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * A raster image (PNG, JPEG, GIF, WebP, BMP, ICO, AVIF) in an editor tab. The bytes are read the first
 * time the tab is shown and held as a `blob:` URL — which the app's CSP admits for images — until the
 * tab closes.
 */
export function ImageFileTab({ workspaceId, script, visible, onClose }: ImageFileTabProps) {
  const [state, setState] = useState<ImageState>({ status: 'idle' })
  const disposed = useRef(false)

  useEffect(() => {
    disposed.current = false
    return () => { disposed.current = true }
  }, [])

  useEffect(() => {
    if (!visible || state.status !== 'idle') return
    setState({ status: 'loading' })
    const mime = rasterImageMime(script.name) ?? 'application/octet-stream'
    window.omnitermAPI.workspace.openImageFile(workspaceId, script.path).then(
      (bytes) => {
        if (disposed.current) return
        // Copied into a fresh buffer: a view over a shared or resizable buffer is not a BlobPart.
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }))
        setState({ status: 'ready', url, size: bytes.byteLength })
      },
      (error: unknown) => {
        if (!disposed.current) setState({ status: 'error', message: message(error) })
      },
    )
  }, [visible, state.status, workspaceId, script.path, script.name])

  const url = state.status === 'ready' ? state.url : null
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  return (
    <div className="file-editor">
      <FileEditorHeader
        script={script}
        dirty={false}
        saving={false}
        canSave={false}
        runLabel={null}
        hasPreview={false}
        mode="preview"
        onModeChange={() => undefined}
        onRun={() => undefined}
        onSave={() => undefined}
        onClose={onClose}
      />
      <div className="file-editor-body">
        <div className="file-editor-full-pane">
          {state.status === 'ready' ? (
            <ImagePreview src={state.url} alt={script.name} sizeBytes={state.size} />
          ) : state.status === 'error' ? (
            <PreviewMessage text={state.message} onAction={() => setState({ status: 'idle' })} />
          ) : (
            <div className="flex items-center justify-center h-full text-[var(--theme-dim)]">
              <Loader2 className="w-5 h-5 animate-spin" aria-label="Loading" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
