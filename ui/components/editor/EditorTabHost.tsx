import { Loader2 } from 'lucide-react'
import { lazy, Suspense, useCallback, type Dispatch, type SetStateAction } from 'react'

import type { WorkspaceScript } from '@omniterm/contract'

import { rasterImageMime } from '../../utils/imageFile'

// The editor and CodeMirror load with the first opened file, not with the app shell.
const FileEditorTab = lazy(() => import('./FileEditorTab').then((module) => ({ default: module.FileEditorTab })))
const ImageFileTab = lazy(() => import('./ImageFileTab').then((module) => ({ default: module.ImageFileTab })))

interface EditorTabHostProps {
  tabId: string
  editor: { workspaceId: string; script: WorkspaceScript }
  visible: boolean
  closeTab: (tabId: string) => void
  /** Promote a disposable preview tab to a kept one. */
  keepTab: (tabId: string) => void
  runScript: (workspaceId: string, script: WorkspaceScript) => void
  setEditorDirty: Dispatch<SetStateAction<Record<string, boolean>>>
}

/** Binds one editor tab to MainLayout's tab bookkeeping, so the layout view only places it. */
export function EditorTabHost({ tabId, editor, visible, closeTab, keepTab, runScript, setEditorDirty }: EditorTabHostProps) {
  const { workspaceId, script } = editor
  const onDirtyChange = useCallback((dirty: boolean) => {
    // An edit is a commitment — a peeked file stops being disposable.
    if (dirty) keepTab(tabId)
    setEditorDirty((prev) => (prev[tabId] === dirty ? prev : { ...prev, [tabId]: dirty }))
  }, [keepTab, setEditorDirty, tabId])
  const onRun = useCallback(() => {
    keepTab(tabId)
    runScript(workspaceId, script)
  }, [keepTab, runScript, tabId, workspaceId, script])
  const onClose = useCallback(() => closeTab(tabId), [closeTab, tabId])

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin" aria-label="Loading" /></div>}>
      {rasterImageMime(script.name) ? (
        <ImageFileTab workspaceId={workspaceId} script={script} visible={visible} onClose={onClose} />
      ) : (
        <FileEditorTab tabId={tabId} workspaceId={workspaceId} script={script} visible={visible}
          onClose={onClose} onRun={onRun} onDirtyChange={onDirtyChange} />
      )}
    </Suspense>
  )
}
