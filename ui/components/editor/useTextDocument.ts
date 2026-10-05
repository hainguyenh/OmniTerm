import { EditorSelection } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { TextEol } from '../../utils/textFileWire'
import {
  applyEffects, createDocState, createDocumentModel, currentState, escalatedProfile, quickDirty, serialize,
  type DocumentModel,
} from './documentModel'
import { languageSlot, profileExtensions, profileSlot } from './editorExtensions'
import { registerDocument, unregisterDocument, updateDocument } from './editorStateCache'
import type { FileProfile } from './fileProfile'
import { loadLanguage, resolveLanguageId, type LanguageId } from './languageLoader'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type SaveResult = 'saved' | 'conflict' | 'error' | 'noop'

export interface DocumentMeta {
  size: number
  mtimeMs: number
  eol: TextEol
  bom: boolean
  mixedEol: boolean
  readOnly: boolean
  profile: FileProfile
}

export interface CursorInfo {
  line: number
  col: number
  selections: number
  selected: number
}

interface Options {
  tabId: string
  workspaceId: string
  path: string
  fileName: string
  visible: boolean
}

/** Equal-length edits are compared in full only after typing pauses. */
const EQ_CHECK_DELAY_MS = 150

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Load, track and save one tab's document. The file is read the first time the tab is shown; the
 * React state here changes only on milestones (loaded, dirty flipped, saved, cursor moved on the next
 * frame) — individual keystrokes never re-render the tab.
 */
export function useTextDocument({ tabId, workspaceId, path, fileName, visible }: Options) {
  const modelRef = useRef<DocumentModel | null>(null)
  if (!modelRef.current) modelRef.current = createDocumentModel()
  const model = modelRef.current
  const languageId: LanguageId = useMemo(() => resolveLanguageId(fileName), [fileName])

  const [status, setStatus] = useState<LoadStatus>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [meta, setMeta] = useState<DocumentMeta | null>(null)
  const [docDirty, setDocDirty] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<'modified' | 'deleted' | null>(null)
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, col: 1, selections: 1, selected: 0 })

  const metaRef = useRef(meta)
  metaRef.current = meta
  const savedFormat = useRef<{ eol: TextEol; bom: boolean }>({ eol: 'lf', bom: false })
  const eqTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cursorFrame = useRef<number | null>(null)
  const disposed = useRef(false)

  const refreshCursor = useCallback(() => {
    cursorFrame.current = null
    const state = currentState(model)
    if (!state) return
    const main = state.selection.main
    const line = state.doc.lineAt(main.head)
    setCursor({
      line: line.number,
      col: main.head - line.from + 1,
      selections: state.selection.ranges.length,
      selected: state.selection.ranges.reduce((sum, range) => sum + range.to - range.from, 0),
    })
  }, [model])

  const onUpdate = useCallback((update: ViewUpdate, generation: number) => {
    if (generation !== model.generation) return
    model.state = update.state
    if (update.docChanged) {
      const doc = update.state.doc
      const quick = quickDirty(doc, model.savedDoc)
      if (eqTimer.current) clearTimeout(eqTimer.current)
      eqTimer.current = null
      if (quick === undefined) {
        eqTimer.current = setTimeout(() => {
          eqTimer.current = null
          const latest = currentState(model)
          if (latest && model.savedDoc) setDocDirty(!latest.doc.eq(model.savedDoc))
        }, EQ_CHECK_DELAY_MS)
      } else {
        setDocDirty(quick)
      }
      const next = escalatedProfile(model.profile, doc)
      if (next !== model.profile) {
        model.profile = next
        // A view may not be updated from inside its own update listener.
        queueMicrotask(() => applyEffects(model, [
          profileSlot.reconfigure(profileExtensions(next)), languageSlot.reconfigure([]),
        ]))
        setMeta((prev) => (prev ? { ...prev, profile: next } : prev))
      }
      model.docListeners.forEach((listener) => listener())
    }
    if ((update.selectionSet || update.docChanged) && cursorFrame.current === null) {
      cursorFrame.current = requestAnimationFrame(refreshCursor)
    }
  }, [model, refreshCursor])
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const load = useCallback(async (mode: 'open' | 'reload') => {
    if (mode === 'open') setStatus('loading')
    try {
      const file = await window.omnitermAPI.workspace.openTextFile(workspaceId, path)
      if (disposed.current) return
      const generation = model.generation + 1
      const head = mode === 'reload' ? currentState(model)?.selection.main.head ?? null : model.restoreHead
      const { state, profile } = createDocState(file, (update) => onUpdateRef.current(update, generation), head)
      model.generation = generation
      model.state = state
      model.savedDoc = state.doc
      model.profile = profile
      model.restoreHead = null
      model.scroll = null
      savedFormat.current = { eol: file.eol, bom: file.hasBom }
      setMeta({
        size: file.size, mtimeMs: file.mtimeMs, eol: file.eol, bom: file.hasBom,
        mixedEol: file.mixedEol, readOnly: file.readOnly, profile,
      })
      setDocDirty(false)
      setConflict(null)
      setSaveError(null)
      setLoadError(null)
      setStatus('ready')
      setEpoch((value) => value + 1)
      updateDocument(tabId, { loaded: true, chars: file.content.length, dirty: false })
      model.docListeners.forEach((listener) => listener())
      if (profile === 'full' && languageId !== 'plaintext') {
        const language = await loadLanguage(languageId)
        if (model.generation === generation) applyEffects(model, [languageSlot.reconfigure(language)])
      }
    } catch (error) {
      if (disposed.current) return
      if (mode === 'open') {
        setLoadError(message(error))
        setStatus('error')
      } else {
        setSaveError(message(error))
      }
    }
  }, [model, workspaceId, path, tabId, languageId])

  useEffect(() => {
    disposed.current = false
    registerDocument(tabId, () => {
      model.restoreHead = model.state?.selection.main.head ?? null
      model.state = null
      model.savedDoc = null
      model.scroll = null
      model.generation += 1
      setStatus('idle')
    })
    return () => {
      disposed.current = true
      unregisterDocument(tabId)
      if (eqTimer.current) clearTimeout(eqTimer.current)
      if (cursorFrame.current !== null) cancelAnimationFrame(cursorFrame.current)
    }
  }, [model, tabId])

  useEffect(() => {
    updateDocument(tabId, { visible })
    if (visible && status === 'idle') void load('open')
  }, [tabId, visible, status, load])

  const dirty = docDirty || (meta !== null
    && (meta.eol !== savedFormat.current.eol || meta.bom !== savedFormat.current.bom))
  useEffect(() => { updateDocument(tabId, { dirty }) }, [tabId, dirty])

  const save = useCallback(async (force = false): Promise<SaveResult> => {
    const state = currentState(model)
    const current = metaRef.current
    if (!state || !current || saving) return 'noop'
    setSaving(true)
    try {
      const outcome = await window.omnitermAPI.workspace.saveTextFile(workspaceId, path, {
        content: serialize(state.doc, current.eol),
        bom: current.bom,
        expectedMtimeMs: current.mtimeMs,
        expectedSize: current.size,
        force,
      })
      if (outcome.status === 'conflict') {
        setConflict(outcome.reason)
        return 'conflict'
      }
      model.savedDoc = state.doc
      savedFormat.current = { eol: current.eol, bom: current.bom }
      setMeta((prev) => (prev ? { ...prev, size: outcome.size, mtimeMs: outcome.mtimeMs, mixedEol: false } : prev))
      const latest = currentState(model)
      setDocDirty(!!latest && latest.doc !== state.doc && !latest.doc.eq(state.doc))
      setConflict(null)
      setSaveError(null)
      return 'saved'
    } catch (error) {
      setSaveError(message(error))
      return 'error'
    } finally {
      setSaving(false)
    }
  }, [model, saving, workspaceId, path])

  const setEol = useCallback((eol: TextEol) => setMeta((prev) => (prev ? { ...prev, eol } : prev)), [])
  const setBom = useCallback((bom: boolean) => setMeta((prev) => (prev ? { ...prev, bom } : prev)), [])
  const reload = useCallback(() => load('reload'), [load])

  /** Put the cursor at `offset`, scroll it into view and focus the editor (JSON "go to error"). */
  const reveal = useCallback((offset: number) => {
    const view = model.view
    if (!view) return
    const head = Math.min(Math.max(offset, 0), view.state.doc.length)
    view.dispatch({
      selection: EditorSelection.cursor(head),
      effects: EditorView.scrollIntoView(head, { y: 'center' }),
    })
    view.focus()
  }, [model])

  const getText = useCallback(() => currentState(model)?.doc.toString() ?? '', [model])
  const subscribe = useCallback((listener: () => void) => {
    model.docListeners.add(listener)
    return () => { model.docListeners.delete(listener) }
  }, [model])

  return {
    model, epoch, status, loadError, meta, dirty, saving, saveError, conflict, cursor, languageId,
    save, reload, setEol, setBom, reveal, getText, subscribe,
    dismissSaveError: () => setSaveError(null),
  }
}

export type TextDocument = ReturnType<typeof useTextDocument>
