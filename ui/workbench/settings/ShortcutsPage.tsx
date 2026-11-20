import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { KeycapCombo } from '../../components/Keycap'
import { DEFAULT_SHORTCUTS, shortcutLabels } from '../../components/mainLayoutShared'
import { Tooltip } from '../../components/Tooltip'
import { SHORTCUT_DESCRIPTIONS } from '../../shortcutHelp'

import { comboFromKeyEvent } from './keyCombo'
import { useAppSettings } from './useAppSettings'
import { useDialogHost } from './useDialogHost'

const isReserved = (combo: string) => ['ctrl+r', 'ctrl+f5'].includes(combo.toLowerCase())

/** Settings › Keymap › OmniTerm Shortcuts: record a binding for each OmniTerm command. */
export function ShortcutsPage() {
  const { appSettings, patch } = useAppSettings()
  const { showAlert, host } = useDialogHost()
  const [recording, setRecording] = useState<keyof ShortcutBindings | null>(null)
  const shortcuts = appSettings?.shortcuts

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const combo = comboFromKeyEvent(e)
      if (!combo) return
      if (isReserved(combo)) {
        void showAlert('Ctrl+R and Ctrl+F5 are native Chromium shortcuts and cannot be changed.', { title: 'Reserved Shortcut', tone: 'warning' })
      } else {
        patch({ shortcuts: { ...DEFAULT_SHORTCUTS, ...shortcuts, [recording]: combo } })
      }
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, shortcuts, patch, showAlert])

  if (!appSettings) return null
  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-theme-dim leading-relaxed">
          Click a binding to record a new shortcut. Modifiers combine automatically.
        </p>
        <Tooltip content="Reset all shortcuts to default bindings" placement="bottom">
          <button
            type="button"
            onClick={() => patch({ shortcuts: { ...DEFAULT_SHORTCUTS } })}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-theme-dim hover:text-theme-accent bg-theme-bg border border-theme-border rounded-lg transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-theme-border pt-3">
        {(Object.keys(shortcutLabels) as Array<keyof ShortcutBindings>).map((key) => {
          const binding = shortcuts?.[key] ?? DEFAULT_SHORTCUTS[key] ?? 'None'
          const isRecording = recording === key
          return (
            <div key={key} className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-lg hover:bg-theme-hover border-b border-theme-border/20">
              <div className="min-w-0 flex flex-col gap-0.5">
                <span className="text-xs text-theme-fg font-medium">{shortcutLabels[key]}</span>
                {SHORTCUT_DESCRIPTIONS[key] && (
                  <span className="text-[10.5px] leading-snug text-theme-dim" data-testid={`shortcut-description-${key}`}>
                    {SHORTCUT_DESCRIPTIONS[key]}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!isRecording && binding !== 'None' && <KeycapCombo shortcut={binding} />}
                <button
                  type="button"
                  onClick={() => setRecording(isRecording ? null : key)}
                  className={`min-w-[70px] text-center text-[10px] font-mono font-bold py-1 px-2 rounded-lg border transition-all ${
                    isRecording
                      ? 'bg-[var(--theme-accent)] text-theme-accent-fg border-[var(--theme-accent)] animate-pulse'
                      : 'bg-theme-bg border-theme-border text-theme-dim hover:text-theme-accent hover:border-theme-accent'
                  }`}
                >
                  {isRecording ? 'Record…' : 'Edit'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {host}
    </div>
  )
}
