import React from 'react'
import { FolderGit2, MoonStar, Settings, Terminal } from 'lucide-react'
import type { AppTheme } from '../../themes'
import { themeCssVars, type ThemeMode } from '../../utils/themeVars'
import { normalizeXtermTheme } from '../../utils/xtermTheme'

/**
 * A miniature OmniTerm painted from a draft theme, so an edit can be judged before it is saved.
 *
 * It is deliberately built from the same `themeCssVars` record `App.tsx` writes onto the document, and
 * runs the terminal palette through the same `normalizeXtermTheme` repair a real pane uses — so what
 * the preview shows is what the app will draw, including a colour the repair had to rescue.
 */

/** A right-hand callout naming the thing on this row, so the effect of a control is unmistakable. */
const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="shrink-0 whitespace-nowrap text-[9px] font-medium text-theme-dim/80 tabular-nums">
    ←—— {children}
  </span>
)

const Row: React.FC<{ note?: string; children: React.ReactNode }> = ({ note, children }) => (
  <div className="flex items-center gap-2">
    <div className="min-w-0 flex-1">{children}</div>
    {note && <Note>{note}</Note>}
  </div>
)

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
] as const

export const ThemePreview: React.FC<{ theme: AppTheme; mode: ThemeMode }> = ({ theme, mode }) => {
  const vars = themeCssVars(theme, mode)
  const xterm = normalizeXtermTheme(theme.terminal[mode], mode === 'light')
  const termBg = xterm.background ?? vars['--theme-bg']
  const termFg = xterm.foreground ?? vars['--theme-fg']

  return (
    <div
      data-testid={`theme-preview-${mode}`}
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border"
      style={{
        ...(vars as React.CSSProperties),
        backgroundColor: 'var(--theme-bg)',
        borderColor: 'var(--theme-border)',
        color: 'var(--theme-fg)',
        fontFamily: 'var(--theme-font-family)',
      }}
    >
      {/* Title bar + session tabs */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 text-[10px]"
        style={{ backgroundColor: 'var(--theme-sidebar-bg)', borderBottom: '1px solid var(--theme-border)' }}
      >
        <span
          className="rounded px-2 py-0.5 font-semibold"
          style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-fg)', borderRadius: 'var(--theme-rounded-sm)' }}
        >
          server-01
        </span>
        <span className="px-2 py-0.5" style={{ color: 'var(--theme-dim)' }}>build</span>
        <span className="ml-auto" style={{ color: 'var(--theme-dim)' }}>▁ ▢ ✕</span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Activity rail */}
        <div
          className="flex w-8 flex-col items-center gap-1 py-1.5"
          style={{ backgroundColor: 'var(--theme-sidebar-bg)', borderRight: '1px solid var(--theme-border)' }}
        >
          <span className="rounded p-1" style={{ backgroundColor: 'var(--theme-hover-bg)', color: 'var(--theme-accent)' }}>
            <FolderGit2 className="h-3 w-3" />
          </span>
          <span className="p-1" style={{ color: 'var(--theme-dim)' }}><Terminal className="h-3 w-3" /></span>
          <span className="mt-auto p-1" style={{ color: 'var(--theme-dim)' }}><MoonStar className="h-3 w-3" /></span>
          <span className="p-1" style={{ color: 'var(--theme-dim)' }}><Settings className="h-3 w-3" /></span>
        </div>

        {/* Side panel */}
        <div
          className="w-24 shrink-0 space-y-0.5 p-1.5 text-[9px]"
          style={{ backgroundColor: 'var(--theme-sidebar-bg)', borderRight: '1px solid var(--theme-border)' }}
        >
          <div className="px-1 py-0.5" style={{ color: 'var(--theme-dim)' }}>WORKSPACE</div>
          <div
            className="truncate px-1 py-0.5"
            style={{ backgroundColor: 'var(--theme-hover-bg)', color: 'var(--theme-fg)', borderRadius: 'var(--theme-rounded-sm)' }}
          >
            hovered row
          </div>
          <div
            className="truncate px-1 py-0.5 font-semibold"
            style={{ backgroundColor: 'var(--theme-selection)', color: 'var(--theme-selection-fg)', borderRadius: 'var(--theme-rounded-sm)' }}
          >
            selected row
          </div>
          <div className="truncate px-1 py-0.5" style={{ color: 'var(--theme-dim)' }}>deploy.sh</div>
        </div>

        {/* Main column: chrome samples over a terminal pane */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <Row note="hover / selected">
            <div className="text-[9px]" style={{ color: 'var(--theme-dim)' }}>Side panel rows, left</div>
          </Row>

          <Row note="card + border">
            <div
              className="space-y-1 border p-1.5"
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-border)',
                borderRadius: 'var(--theme-rounded-md)',
                padding: 'var(--theme-padding-sm)',
              }}
            >
              <div className="text-[9px]" style={{ color: 'var(--theme-dim)' }}>Host</div>
              <div
                className="border px-1.5 py-0.5 text-[10px]"
                style={{ borderColor: 'var(--theme-border)', borderRadius: 'var(--theme-rounded-sm)', backgroundColor: 'var(--theme-bg)' }}
              >
                10.0.0.4
              </div>
            </div>
          </Row>

          <Row note="accent / danger">
            <div className="flex items-center gap-1.5">
              <span
                className="px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: 'var(--theme-accent)', color: 'var(--theme-accent-fg)', borderRadius: 'var(--theme-rounded-md)' }}
              >
                Connect
              </span>
              <span
                className="border px-2 py-0.5 text-[10px]"
                style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-fg)', borderRadius: 'var(--theme-rounded-md)' }}
              >
                Cancel
              </span>
              <span className="text-[10px] font-semibold" style={{ color: 'var(--theme-error)' }}>Delete</span>
            </div>
          </Row>

          <Row note="status colours">
            <div className="flex items-center gap-1.5 text-[9px] font-semibold">
              <span style={{ color: 'var(--theme-success)' }}>● connected</span>
              <span style={{ color: 'var(--theme-warning)' }}>● retrying</span>
              <span style={{ color: 'var(--theme-error)' }}>● refused</span>
            </div>
          </Row>

          <Row note="modal overlay">
            <div
              className="flex items-center justify-center py-1 text-[9px]"
              style={{ backgroundColor: 'var(--theme-overlay)', borderRadius: 'var(--theme-rounded-sm)' }}
            >
              <span
                className="border px-2 py-0.5"
                style={{ backgroundColor: 'var(--theme-popup-bg)', borderColor: 'var(--theme-border)', borderRadius: 'var(--theme-rounded-sm)' }}
              >
                Dialog on the scrim
              </span>
            </div>
          </Row>

          {/* Terminal pane — the repaired xterm palette, not the raw theme values */}
          <Row note="terminal">
            <div
              className="space-y-1 p-1.5 font-mono text-[9px] leading-tight"
              style={{ backgroundColor: termBg, color: termFg, borderRadius: 'var(--theme-rounded-md)', fontFamily: 'var(--theme-font-mono)' }}
            >
              <div>
                <span style={{ color: xterm.green }}>user@host</span>
                <span style={{ color: xterm.brightBlack }}>:</span>
                <span style={{ color: xterm.blue }}>~/omniterm</span>
                <span style={{ color: xterm.brightBlack }}>$ </span>
                <span>pnpm build</span>
                <span style={{ backgroundColor: xterm.cursor, color: xterm.cursorAccent }}>_</span>
              </div>
              <div className="flex flex-wrap gap-[2px]">
                {ANSI_KEYS.map((key) => (
                  <span key={key} title={key} className="inline-block h-2 w-2 rounded-[1px]" style={{ backgroundColor: xterm[key] }} />
                ))}
              </div>
              <div>
                <span style={{ backgroundColor: xterm.blue, color: xterm.brightWhite, fontWeight: 700 }}> AGENT </span>
                <span style={{ color: xterm.brightBlack }}> dim note </span>
                <span style={{ backgroundColor: xterm.selectionBackground, color: xterm.selectionForeground ?? termFg }}>selected text</span>
              </div>
              <div>
                <span style={{ color: xterm.yellow }}>warning</span>
                <span style={{ color: xterm.brightBlack }}> · </span>
                <span style={{ color: xterm.red }}>error</span>
                <span style={{ color: xterm.brightBlack }}> · </span>
                <span style={{ color: xterm.brightGreen }}>ok</span>
              </div>
            </div>
          </Row>

          <Row note="radius / spacing">
            <div className="flex items-center gap-1">
              {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
                <span
                  key={size}
                  className="border text-[8px]"
                  style={{
                    borderColor: 'var(--theme-border)',
                    borderRadius: `var(--theme-rounded-${size})`,
                    padding: `var(--theme-padding-${size})`,
                    color: 'var(--theme-dim)',
                  }}
                >
                  {size}
                </span>
              ))}
            </div>
          </Row>
        </div>
      </div>
    </div>
  )
}

export default ThemePreview
