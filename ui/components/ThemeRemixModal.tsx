import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2, Copy, Check, Moon, Sun, FolderOpen, RefreshCw, RotateCcw, Save, Undo2 } from 'lucide-react'
import { AppTheme, DEFAULT_THEME_ID, TOKYO_NIGHT } from '../themes'
import type { ColorField, ThemeMode } from '../utils/themeVars'
import { useEscToClose } from '../hooks/useEscToClose'
import { useThemeDraft } from './themeRemix/useThemeDraft'
import { AppColorFields, LayoutFields, TerminalColorFields } from './themeRemix/ThemeEditorFields'
import ThemePreview from './themeRemix/ThemePreview'

/** Preview modes: one at full width, or both side by side for comparing a colour across them. */
type PreviewMode = ThemeMode | 'both'

interface ThemeRemixModalProps {
  isOpen: boolean
  onClose: () => void
  themes: AppTheme[]
  setThemes: (t: AppTheme[]) => void
  appSettings: AppSettings
  setAppSettings: (s: AppSettings) => void
  currentTheme: AppTheme
}

const isCustom = (theme: AppTheme) => theme.id.startsWith('theme-')

export const ThemeRemixModal: React.FC<ThemeRemixModalProps> = ({
  isOpen,
  onClose,
  themes,
  setThemes,
  appSettings,
  setAppSettings,
  currentTheme,
}) => {
  const [selectedThemeId, setSelectedThemeId] = useState<string>(currentTheme.id)
  const [editMode, setEditMode] = useState<ThemeMode>(appSettings.darkMode ? 'dark' : 'light')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('both')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [frame, setFrame] = useState({ x: 0, y: 0, width: 1200, height: 720 })
  const interaction = useRef<{ kind: 'move' | 'resize'; x: number; y: number; frame: typeof frame } | null>(null)
  const currentThemeRef = useRef(currentTheme.id)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = interaction.current
      if (!current) return
      const dx = event.clientX - current.x
      const dy = event.clientY - current.y
      setFrame(current.kind === 'move'
        ? { ...current.frame, x: current.frame.x + dx, y: current.frame.y + dy }
        : { ...current.frame, width: Math.max(720, current.frame.width + dx), height: Math.max(480, current.frame.height + dy) })
    }
    const stop = () => { interaction.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
  }, [])

  const selectedTheme = themes.find(t => t.id === selectedThemeId) ?? currentTheme
  const { draft, dirty, setName, setColor, setUiField, revert, adoptPalette } = useThemeDraft(selectedTheme)
  useEffect(() => {
    const changedExternally = currentThemeRef.current !== currentTheme.id
    currentThemeRef.current = currentTheme.id
    if (isOpen && !dirty && (changedExternally || !themes.some(theme => theme.id === selectedThemeId))) setSelectedThemeId(currentTheme.id)
  }, [currentTheme.id, dirty, isOpen, selectedThemeId, themes])

  const guardedClose = useCallback(() => (dirty ? setConfirmDiscard(true) : onClose()), [dirty, onClose])
  useEscToClose(dirty, onClose, () => setConfirmDiscard(true), isOpen && !confirmDiscard)

  const refreshThemes = async (selectId?: string): Promise<AppTheme[]> => {
    setIsRefreshing(true)
    try {
      const list = await window.omnitermAPI.themes.list()
      setThemes(list)
      if (selectId) setSelectedThemeId(selectId)
      return list
    } finally {
      setIsRefreshing(false)
    }
  }

  const makeThemeId = () => `theme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const persistSelection = async (themeId: string) => {
    const next = { ...appSettings, themeId }
    setAppSettings(next)
    await window.omnitermAPI.settings.save(next)
  }

  const addTheme = async (name: string, base: AppTheme) => {
    const newId = makeThemeId()
    const created: AppTheme = {
      id: newId,
      name,
      terminal: { dark: { ...base.terminal.dark }, light: { ...base.terminal.light } },
      ui: { dark: { ...base.ui.dark }, light: { ...base.ui.light } },
    }
    await window.omnitermAPI.themes.save(created)
    await refreshThemes(newId)
    await persistSelection(newId)
  }

  const handleCreate = () =>
    addTheme(`New Remix ${themes.filter(t => isCustom(t)).length + 1}`, draft)

  const handleDuplicate = (theme: AppTheme) => addTheme(`${theme.name} Copy`.slice(0, 40), theme)

  const handleDelete = async (theme: AppTheme) => {
    if (theme.id === DEFAULT_THEME_ID || themes.length <= 1) return
    const fallbackId = themes.find(t => t.id !== theme.id)?.id ?? DEFAULT_THEME_ID
    await window.omnitermAPI.themes.delete(theme.id)
    await refreshThemes(fallbackId)
    if (appSettings.themeId === theme.id) await persistSelection(fallbackId)
  }

  const handleApply = async () => {
    setSelectedThemeId(draft.id)
    await persistSelection(draft.id)
  }

  /** Write the draft to its JSON file. The applied theme picks the change up through the refreshed list. */
  const handleSave = async () => {
    setBusy(true)
    try {
      await window.omnitermAPI.themes.save(draft)
      await refreshThemes()
    } finally {
      setBusy(false)
    }
  }

  /**
   * Built-in: drop the user's override so the shipped JSON comes back (`save_theme` writes a same-id
   * copy into the user themes folder, so deleting that copy *is* the reset).
   * Custom: load the default palette into the draft, unsaved until the user saves.
   */
  const handleResetToDefault = async () => {
    setBusy(true)
    try {
      if (isCustom(draft)) {
        adoptPalette(TOKYO_NIGHT)
        return
      }
      await window.omnitermAPI.themes.delete(draft.id)
      const list = await refreshThemes()
      const restored = list.find(t => t.id === draft.id)
      if (restored) adoptPalette(restored)
    } finally {
      setBusy(false)
    }
  }

  if (!isOpen) return null

  const onColorChange = (field: ColorField, value: string) => setColor(field, editMode, value)
  const onUiFieldChange = (key: string, value: string) => setUiField(editMode, key, value)
  const previewModes: ThemeMode[] = previewMode === 'both' ? ['dark', 'light'] : [previewMode]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'var(--theme-overlay)' }}
    >
      <div
        className="relative flex max-h-[94vh] max-w-[96vw] flex-col overflow-hidden rounded-2xl border border-theme-border bg-theme-popup text-theme-fg shadow-2xl"
        style={{ width: `${frame.width}px`, height: `${frame.height}px`, transform: `translate(${frame.x}px, ${frame.y}px)` }}
      >
        {/* Header */}
        <div
          className="flex cursor-move items-center justify-between gap-4 border-b border-theme-border px-4 py-3"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button, input')) return
            interaction.current = { kind: 'move', x: event.clientX, y: event.clientY, frame }
          }}
        >
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-theme-fg">Theme Remix</h2>
            <p className="text-xs text-theme-dim">
              Edit every colour the app can paint and watch both appearance modes react as you type.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {dirty && <span className="text-[11px] font-semibold text-theme-warning">Unsaved changes</span>}
            <button
              type="button"
              onClick={() => { void handleResetToDefault() }}
              disabled={busy}
              title={isCustom(draft) ? 'Load the default palette into this theme' : 'Restore the built-in palette'}
              className="flex items-center gap-1 rounded-lg border border-theme-border px-2.5 py-1.5 text-xs text-theme-dim hover:bg-theme-hover hover:text-theme-fg disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />Reset to default
            </button>
            <button
              type="button"
              onClick={revert}
              disabled={!dirty}
              title="Discard unsaved edits"
              className="flex items-center gap-1 rounded-lg border border-theme-border px-2.5 py-1.5 text-xs text-theme-dim hover:bg-theme-hover hover:text-theme-fg disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />Revert
            </button>
            <button
              type="button"
              onClick={() => { void handleSave() }}
              disabled={!dirty || busy}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-theme-accent-fg disabled:opacity-40"
              style={{ backgroundColor: 'var(--theme-accent)' }}
            >
              <Save className="h-3.5 w-3.5" />Save
            </button>

            <span className="mx-1 h-5 w-px" style={{ backgroundColor: 'var(--theme-border)' }} />

            <button
              type="button"
              onClick={() => { void refreshThemes() }}
              disabled={isRefreshing}
              title="Reload themes from JSON files"
              className="rounded-lg p-1 text-theme-dim transition-colors hover:bg-theme-hover hover:text-theme-fg disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => { void window.omnitermAPI.themes.openFolder() }}
              title="Open themes folder"
              className="rounded-lg p-1 text-theme-dim transition-colors hover:bg-theme-hover hover:text-theme-fg"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={guardedClose}
              title="Close"
              className="rounded-lg p-1 text-theme-dim transition-colors hover:bg-theme-hover hover:text-theme-fg"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {confirmDiscard && (
          <div className="flex items-center justify-between gap-3 border-b border-theme-border px-4 py-2 text-xs"
            style={{ backgroundColor: 'var(--theme-hover-bg)' }}
          >
            <span className="text-theme-fg">This theme has unsaved changes.</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="rounded-lg border border-theme-border px-2.5 py-1 text-theme-dim hover:text-theme-fg"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => { revert(); setConfirmDiscard(false); onClose() }}
                className="rounded-lg px-2.5 py-1 font-semibold text-theme-error hover:bg-theme-hover"
              >
                Discard changes
              </button>
            </span>
          </div>
        )}

        {/* Body: theme list │ editor │ preview */}
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-52 flex-shrink-0 flex-col gap-3 border-r border-theme-border p-3">
            <button
              type="button"
              onClick={() => { void handleCreate() }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-theme-accent-fg"
              style={{ backgroundColor: 'var(--theme-accent)' }}
            >
              <Plus className="h-3.5 w-3.5" />New Custom Theme
            </button>
            <div className="no-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
              {themes.map(t => {
                const isSelected = t.id === selectedThemeId
                return (
                  <div
                    key={t.id}
                    className={`group flex items-center justify-between rounded-lg p-2 transition-colors ${isSelected ? '' : 'hover:bg-theme-hover'}`}
                    style={isSelected ? { backgroundColor: 'var(--theme-hover-bg)' } : undefined}
                  >
                    <button type="button" onClick={() => setSelectedThemeId(t.id)} className="min-w-0 flex-1 text-left">
                      <span className="flex items-center gap-1 truncate text-xs font-semibold">
                        {t.name}
                        {t.id === appSettings.themeId && (
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--theme-success)' }} title="Active theme" />
                        )}
                      </span>
                      <span className="block text-[10px] text-theme-dim">{isCustom(t) ? 'Custom' : 'Built-in'}</span>
                    </button>
                    <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button type="button" onClick={() => { void handleDuplicate(t) }} title="Duplicate" className="rounded p-1 hover:bg-theme-hover">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {isCustom(t) && (
                        <button type="button" onClick={() => { void handleDelete(t) }} title="Delete" className="rounded p-1 text-theme-error hover:bg-theme-hover">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* Editor */}
          <section className="no-scrollbar flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <div className="flex flex-wrap items-end gap-3 border-b border-theme-border pb-3">
              <div className="min-w-[180px] flex-1">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-theme-dim" htmlFor="theme-name">
                  Theme name
                </label>
                <input
                  id="theme-name"
                  type="text"
                  value={draft.name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none"
                  style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)', color: 'var(--theme-fg)' }}
                />
              </div>
              <button
                type="button"
                onClick={() => { void handleApply() }}
                disabled={appSettings.themeId === draft.id}
                className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold text-theme-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: 'var(--theme-accent)' }}
              >
                <Check className="h-3.5 w-3.5" />Apply This Theme
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-theme-dim">Editing variant</span>
              <div className="flex items-center gap-1">
                {(['dark', 'light'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setEditMode(mode)}
                    title={`Edit ${mode} variant`}
                    className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition-all"
                    style={editMode === mode
                      ? { borderColor: 'var(--theme-accent)', backgroundColor: 'var(--theme-accent)', color: 'var(--theme-accent-fg)' }
                      : { borderColor: 'var(--theme-border)', color: 'var(--theme-dim)' }}
                  >
                    {mode === 'dark' ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                    {mode === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </div>

            <AppColorFields theme={draft} mode={editMode} onColorChange={onColorChange} onUiFieldChange={onUiFieldChange} />
            <TerminalColorFields theme={draft} mode={editMode} onColorChange={onColorChange} onUiFieldChange={onUiFieldChange} />
            <LayoutFields theme={draft} mode={editMode} onColorChange={onColorChange} onUiFieldChange={onUiFieldChange} />
          </section>

          {/* Preview */}
          <section className="flex w-[46%] min-w-0 flex-col gap-2 border-l border-theme-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-theme-dim">Live preview</span>
              <div role="radiogroup" aria-label="Preview mode" className="flex items-center gap-1">
                {([['dark', 'Dark'], ['light', 'Light'], ['both', 'Both']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={previewMode === value}
                    onClick={() => setPreviewMode(value)}
                    className="rounded-lg border px-2.5 py-1 text-[10px] font-bold transition-all"
                    style={previewMode === value
                      ? { borderColor: 'var(--theme-accent)', backgroundColor: 'var(--theme-accent)', color: 'var(--theme-accent-fg)' }
                      : { borderColor: 'var(--theme-border)', color: 'var(--theme-dim)' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={`no-scrollbar grid min-h-0 flex-1 gap-3 overflow-y-auto ${previewMode === 'both' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {previewModes.map(mode => (
                <div key={mode} className="flex min-h-0 min-w-0 flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-theme-dim">
                    {mode === 'dark' ? 'Dark mode' : 'Light mode'}
                  </span>
                  <ThemePreview theme={draft} mode={mode} />
                </div>
              ))}
            </div>
          </section>
        </div>
        <button
          type="button"
          aria-label="Resize Theme Remix"
          className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize text-theme-dim/70 hover:text-theme-fg"
          onPointerDown={(event) => {
            event.preventDefault()
            interaction.current = { kind: 'resize', x: event.clientX, y: event.clientY, frame }
          }}
        >↘</button>
      </div>
    </div>
  )
}
