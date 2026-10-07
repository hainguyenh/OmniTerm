import React, { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'

import { KeycapCombo } from './Keycap'
import { Tooltip } from './Tooltip'
import {
  DEFAULT_EDITOR_SHORTCUTS,
  EDITOR_SHORTCUT_DESCRIPTIONS,
  FOLD_SHORTCUT_KEYS,
  NAV_SHORTCUT_KEYS,
  editorShortcutLabels,
  resolveDisabledEditorShortcuts,
  resolveEditorShortcuts,
  type EditorShortcutBindings,
} from './editor/editorShortcuts'

export interface EditorShortcutsSettingsProps {
  appSettings: AppSettings
  setAppSettings: (settings: AppSettings) => void
  showAlert?: (message: string, options?: { title?: string; tone?: 'warning' | 'error' | 'info' }) => void
}

export const EditorShortcutsSettings: React.FC<EditorShortcutsSettingsProps> = ({
  appSettings,
  setAppSettings,
  showAlert,
}) => {
  const [recordingKey, setRecordingKey] = useState<keyof EditorShortcutBindings | null>(null)

  const currentShortcuts = resolveEditorShortcuts(appSettings.editorShortcuts)
  const disabledShortcuts = resolveDisabledEditorShortcuts(appSettings.editorShortcutsDisabled)

  // Reset restores the default bindings and switches every shortcut back on.
  const handleReset = () => {
    const nextSettings = {
      ...appSettings,
      editorShortcuts: { ...DEFAULT_EDITOR_SHORTCUTS },
      editorShortcutsDisabled: [],
    }
    setAppSettings(nextSettings)
    void window.omnitermAPI.settings.save({
      editorShortcuts: { ...DEFAULT_EDITOR_SHORTCUTS },
      editorShortcutsDisabled: [],
    })
  }

  // Switching a shortcut off keeps its binding, so switching it back on restores the user's choice.
  const toggleShortcut = (key: keyof EditorShortcutBindings) => {
    const next = disabledShortcuts.has(key)
      ? [...disabledShortcuts].filter((k) => k !== key)
      : [...disabledShortcuts, key]
    setAppSettings({ ...appSettings, editorShortcutsDisabled: next })
    void window.omnitermAPI.settings.save({ editorShortcutsDisabled: next })
  }

  useEffect(() => {
    if (!recordingKey) return

    const handleRecordKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecordingKey(null)
        return
      }

      const lowerKey = e.key.toLowerCase()
      if (['control', 'shift', 'alt', 'meta'].includes(lowerKey)) {
        return
      }

      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')

      let keyName = e.key
      if (keyName === ' ') keyName = 'Space'
      if (keyName.length === 1) keyName = keyName.toUpperCase()
      parts.push(keyName)

      const combo = parts.join('+')
      const lowerCombo = combo.toLowerCase()

      if (lowerCombo === 'ctrl+r' || lowerCombo === 'ctrl+f5') {
        showAlert?.('Ctrl+R and Ctrl+F5 are native Chromium shortcuts and cannot be changed.', {
          title: 'Reserved Shortcut',
          tone: 'warning',
        })
        setRecordingKey(null)
        return
      }

      const updated = {
        ...currentShortcuts,
        [recordingKey]: combo,
      }
      const nextSettings = {
        ...appSettings,
        editorShortcuts: updated,
      }
      setAppSettings(nextSettings)
      void window.omnitermAPI.settings.save(nextSettings)
      setRecordingKey(null)
    }

    window.addEventListener('keydown', handleRecordKey, true)
    return () => {
      window.removeEventListener('keydown', handleRecordKey, true)
    }
  }, [recordingKey, appSettings, currentShortcuts, setAppSettings, showAlert])

  const renderShortcutRow = (key: keyof EditorShortcutBindings) => {
    const label = editorShortcutLabels[key]
    const currentBinding = currentShortcuts[key] ?? DEFAULT_EDITOR_SHORTCUTS[key] ?? 'None'
    const isRecording = recordingKey === key
    const enabled = !disabledShortcuts.has(key)

    return (
      <div
        key={key}
        className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-lg hover:bg-white/5 border-b border-theme-border/20"
      >
        <div className={`min-w-0 flex flex-col gap-0.5 ${enabled ? '' : 'opacity-50'}`}>
          <span className="text-xs text-theme-fg font-medium">{label}</span>
          {EDITOR_SHORTCUT_DESCRIPTIONS[key] && (
            <span
              className="text-[10.5px] leading-snug text-theme-dim"
              data-testid={`editor-shortcut-description-${key}`}
            >
              {EDITOR_SHORTCUT_DESCRIPTIONS[key]}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isRecording && currentBinding !== 'None' && (
            <span className={enabled ? '' : 'opacity-50'}>
              <KeycapCombo shortcut={currentBinding} />
            </span>
          )}
          <Tooltip
            content={isRecording ? 'Press keys or Esc to cancel' : 'Click to record new shortcut'}
            placement="left"
          >
            <button
              type="button"
              onClick={() => setRecordingKey(isRecording ? null : key)}
              className={`min-w-[70px] text-center text-[10px] font-mono font-bold py-1 px-2 rounded-lg border transition-all ${
                isRecording
                  ? 'bg-[var(--theme-accent)] text-theme-accent-fg border-[var(--theme-accent)] animate-pulse'
                  : 'bg-theme-bg border-theme-border text-theme-dim hover:text-theme-accent hover:border-theme-accent'
              }`}
            >
              {isRecording ? 'Recording…' : currentBinding}
            </button>
          </Tooltip>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${enabled ? 'Disable' : 'Enable'} ${label}`}
            data-testid={`editor-shortcut-toggle-${key}`}
            onClick={() => toggleShortcut(key)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-border)]'}`}
          >
            {/* Anchored with `left`, not `translate-x`: a <button> centers its content, so a
                translate-only knob would start mid-pill (same fix as PluginManager's switch). */}
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-theme-fg uppercase tracking-wider">
            Editor Shortcuts
          </h3>
          <p className="text-[11px] text-theme-dim leading-relaxed mt-0.5">
            Configure hotkeys for code folding, search, and navigation in the editor. Switch a hotkey
            off to stop it from firing.
          </p>
        </div>
        <Tooltip content="Reset editor shortcuts to defaults" placement="bottom">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-theme-dim hover:text-theme-accent bg-theme-bg border border-theme-border rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </Tooltip>
      </div>

      {/* Code Folding Section */}
      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-semibold text-theme-dim uppercase tracking-wider px-1">
          Code Folding
        </h4>
        <div className="flex flex-col gap-1 border-t border-theme-border pt-1">
          {FOLD_SHORTCUT_KEYS.map((key) => renderShortcutRow(key))}
        </div>
      </div>

      {/* Search & Navigation Section */}
      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-semibold text-theme-dim uppercase tracking-wider px-1">
          Search &amp; Navigation
        </h4>
        <div className="flex flex-col gap-1 border-t border-theme-border pt-1">
          {NAV_SHORTCUT_KEYS.map((key) => renderShortcutRow(key))}
        </div>
      </div>
    </div>
  )
}

export default EditorShortcutsSettings
