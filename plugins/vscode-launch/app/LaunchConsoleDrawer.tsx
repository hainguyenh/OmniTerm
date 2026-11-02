import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { TerminalLinkMenu } from '../../../ui/components/TerminalLinkMenu'
import { showPixelCopiedToast } from '../../../ui/utils/pixelCopiedToast'
import { resolveTerminalFontFamily } from '../../../ui/utils/terminalOptions'
import type { EditorKind } from '../src/types'

import { AnsiLine } from './ansiOutput'
import { stripAnsi } from './ansiParser'
import { LaunchAttachBanner } from './LaunchAttachBanner'
import { LaunchConsoleToolbar } from './LaunchConsoleToolbar'
import { LaunchTabMenu } from './LaunchTabMenu'
import { LaunchTabsStrip } from './LaunchTabsStrip'
import {
  closeConsole,
  closeTargetConsole,
  restartRun,
  selectConsoleRun,
  setConsoleHeight,
  stopRuns,
  useLaunchStore,
} from './launchStore'
import { openExternalUrl, resolveBrowserUrl, writeClipboardText } from './openUrl'
import { useRunLogs } from './useRunLogs'
import type { VsCodeLaunchAPI } from './vscodeLaunchAPI'

export interface LaunchTerminalPopoutSpec {
  name: string
  cwd: string
  terminalCommand: string
}

export interface LaunchConsoleDrawerProps {
  api: VsCodeLaunchAPI
  fontSize?: number
  fontFamilyMono?: string
  onOpenInTerminal: (spec: LaunchTerminalPopoutSpec) => void
}

export function LaunchConsoleDrawer({
  api,
  fontSize,
  fontFamilyMono,
  onOpenInTerminal,
}: LaunchConsoleDrawerProps) {
  const runs = useLaunchStore((s) => s.runs)
  const activeRunId = useLaunchStore((s) => s.activeRunId)
  const consoleHeight = useLaunchStore((s) => s.consoleHeight)
  const editors = useLaunchStore((s) => s.editors)

  const resolvedFontFamily = useMemo(
    () => resolveTerminalFontFamily(fontFamilyMono),
    [fontFamilyMono],
  )

  const [consoleFontSize, setConsoleFontSize] = useState<number>(fontSize ?? 14)
  const [filterText, setFilterText] = useState('')
  const [stdinValue, setStdinValue] = useState('')
  const [copiedLogs, setCopiedLogs] = useState(false)
  const [linkMenu, setLinkMenu] = useState<{ x: number; y: number; kind: 'url'; text: string } | null>(null)
  const [tabMenu, setTabMenu] = useState<{
    x: number
    y: number
    run: (typeof runs)[number]
  } | null>(null)

  useEffect(() => {
    if (fontSize !== undefined && Number.isFinite(fontSize)) {
      setConsoleFontSize(fontSize)
    }
  }, [fontSize])

  const handleViewportWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      setConsoleFontSize((prev) =>
        Math.max(8, Math.min(48, prev + (e.deltaY > 0 ? -1 : 1))),
      )
    }
  }, [])

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const activeRun = useMemo(
    () => runs.find((r) => r.runId === activeRunId) ?? runs[0] ?? null,
    [runs, activeRunId],
  )
  const resolvedRunId = activeRun?.runId ?? null
  const isRunning = activeRun?.status === 'starting' || activeRun?.status === 'running'
  const activeRunBrowserUrl = resolveBrowserUrl(activeRun)

  const { activeBuffer, clearBuffer } = useRunLogs(api, resolvedRunId, isRunning)

  const preferredEditor: EditorKind | undefined = editors.includes('codium')
    ? 'codium'
    : editors.includes('code')
      ? 'code'
      : undefined

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
    }
  }, [])

  const visibleLines = useMemo(() => {
    const rawLines = activeBuffer?.lines ?? []
    const needle = filterText.trim().toLowerCase()
    if (!needle) return rawLines
    return rawLines.filter((line) => stripAnsi(line.text).toLowerCase().includes(needle))
  }, [activeBuffer, filterText])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [visibleLines.length, activeRun?.runId])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  }, [])

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragCleanupRef.current?.()
      const startY = event.clientY
      const startHeight = consoleHeight

      const onMove = (moveEvent: MouseEvent) => {
        const delta = startY - moveEvent.clientY
        setConsoleHeight(startHeight + delta)
      }
      const cleanup = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', cleanup)
        dragCleanupRef.current = null
      }
      dragCleanupRef.current = cleanup
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', cleanup)
    },
    [consoleHeight],
  )

  const handleClearActive = useCallback(() => {
    if (activeRun) clearBuffer(activeRun.runId)
  }, [activeRun, clearBuffer])

  const handleTabContextMenu = useCallback(
    (e: React.MouseEvent, run: (typeof runs)[number]) => {
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent?.preventDefault?.()
      e.nativeEvent?.stopImmediatePropagation?.()
      selectConsoleRun(run.runId)
      setTabMenu({ x: e.clientX, y: e.clientY, run })
    },
    [],
  )

  const handleCopyAttachJson = useCallback(
    async (json: string, clientX?: number, clientY?: number) => {
      await writeClipboardText(json)
      if (
        clientX !== undefined &&
        clientY !== undefined &&
        Number.isFinite(clientX) &&
        Number.isFinite(clientY)
      ) {
        showPixelCopiedToast(clientX, clientY)
      }
    },
    [],
  )

  const handleCopyLogs = useCallback(
    async (e?: React.MouseEvent) => {
      const plain = visibleLines.map((line) => stripAnsi(line.text)).join('\n')
      await writeClipboardText(plain)
      if (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
        showPixelCopiedToast(e.clientX, e.clientY)
      }
      setCopiedLogs(true)
      setTimeout(() => setCopiedLogs(false), 1_500)
    },
    [visibleLines],
  )

  const handleCopySelection = useCallback((text: string) => {
    void writeClipboardText(text)
    setCopiedLogs(true)
    setTimeout(() => setCopiedLogs(false), 1_500)
  }, [])

  const handleViewportContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const selection = window.getSelection()?.toString()
      if (selection && selection.trim().length > 0) {
        void writeClipboardText(selection)
        showPixelCopiedToast(e.clientX, e.clientY)
        setCopiedLogs(true)
        setTimeout(() => setCopiedLogs(false), 1_500)
      }
    },
    [],
  )

  const handleSendInput = useCallback(async () => {
    if (!activeRun || !stdinValue) return
    const payload = `${stdinValue}\n`
    setStdinValue('')
    await api.sendInput(activeRun.runId, payload)
  }, [activeRun, api, stdinValue])

  return (
    <section
      data-testid="launch-console-drawer"
      aria-label="Launch Console"
      style={{
        height: `${consoleHeight}px`,
        '--pane-font-mono': resolvedFontFamily,
      } as React.CSSProperties}
      className="absolute inset-x-0 bottom-0 z-40 flex flex-col bg-theme-bg border-t border-theme-border text-theme-fg select-none"
    >
      {/* Resize handle */}
      <div
        data-testid="launch-console-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize launch console"
        onMouseDown={handleResizeStart}
        className="h-1.5 w-full cursor-row-resize hover:bg-theme-accent/30 transition-colors shrink-0"
      />

      {/* Header bar: run tabs + search + run actions */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-theme-sidebar border-b border-theme-border shrink-0">
        <LaunchTabsStrip
          runs={runs}
          activeRunId={activeRun?.runId ?? null}
          onSelectRun={selectConsoleRun}
          onCloseRun={(runId) => void closeTargetConsole(runId)}
          onContextMenuRun={handleTabContextMenu}
        />

        <LaunchConsoleToolbar
          filterText={filterText}
          onFilterChange={setFilterText}
          activeRun={activeRun}
          isRunning={isRunning}
          activeRunBrowserUrl={activeRunBrowserUrl}
          copiedLogs={copiedLogs}
          onOpenBrowser={(url) => void openExternalUrl(url, api)}
          onOpenInTerminal={() =>
            activeRun &&
            onOpenInTerminal({
              name: `Launch: ${activeRun.name}`,
              cwd: activeRun.cwd,
              terminalCommand: activeRun.terminalCommand,
            })
          }
          onCopyLogs={(e) => void handleCopyLogs(e)}
          onRestart={() => activeRun && void restartRun(activeRun.runId, activeRun.mode)}
          onStop={() => activeRun && void stopRuns([activeRun.runId])}
          onClearOutput={handleClearActive}
          onClose={closeConsole}
        />
      </div>

      {/* Debug / VSCodium / netcoredbg attach strip */}
      {activeRun?.mode === 'debug' && activeRun.attach && (
        <LaunchAttachBanner
          run={activeRun}
          preferredEditor={preferredEditor}
          api={api}
          writeClipboard={writeClipboardText}
        />
      )}

      {/* Streaming ANSI log viewport */}
      <div
        ref={scrollContainerRef}
        role="tabpanel"
        onScroll={handleScroll}
        onWheel={handleViewportWheel}
        onContextMenu={handleViewportContextMenu}
        style={{
          fontFamily: resolvedFontFamily,
          fontSize: `${consoleFontSize}px`,
          lineHeight: 1.45,
        }}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono launch-console-viewport select-text selection:bg-theme-selection selection:text-theme-selection-fg"
      >
        {activeBuffer?.truncated && (
          <div className="mb-1.5 text-[11px] text-theme-dim italic">
            Earlier lines were trimmed to keep the console responsive.
          </div>
        )}

        {visibleLines.length === 0 ? (
          <div className="text-theme-dim py-2" style={{ fontSize: `${Math.min(13, consoleFontSize)}px` }}>
            {activeRun
              ? filterText.trim()
                ? 'No output lines match the current filter.'
                : `Waiting for output from ${activeRun.name}...`
              : 'Select a launch configuration from a pane header to view its output.'}
          </div>
        ) : (
          visibleLines.map((line) => (
            <div
              key={line.seq}
              className={`whitespace-pre-wrap break-all ${
                line.stream === 'stderr'
                  ? 'text-theme-error'
                  : line.stream === 'system'
                    ? 'text-theme-dim italic'
                    : 'text-theme-fg'
              }`}
            >
              <AnsiLine
                text={line.text}
                onLinkAction={setLinkMenu}
                onOpenUrl={(url) => void openExternalUrl(url, api)}
                onCopySelection={handleCopySelection}
              />
            </div>
          ))
        )}
      </div>

      {/* Stdin prompt row for interactive launches */}
      {activeRun && isRunning && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-theme-border bg-theme-sidebar shrink-0">
          <span
            className="font-mono text-theme-dim select-none"
            style={{ fontFamily: resolvedFontFamily, fontSize: `${consoleFontSize}px` }}
          >
            &gt;
          </span>
          <input
            type="text"
            value={stdinValue}
            onChange={(e) => setStdinValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleSendInput()
              }
            }}
            placeholder="Send input to stdin and press Enter..."
            aria-label="Send input to stdin"
            style={{ fontFamily: resolvedFontFamily, fontSize: `${consoleFontSize}px` }}
            className="flex-1 bg-transparent font-mono text-theme-fg placeholder:text-theme-dim focus:outline-none"
          />
        </div>
      )}

      {linkMenu && (
        <TerminalLinkMenu
          x={linkMenu.x}
          y={linkMenu.y}
          kind={linkMenu.kind}
          text={linkMenu.text}
          isLocal={true}
          onCopyText={(text) => void writeClipboardText(text)}
          onOpenUrl={(url) => void openExternalUrl(url, api)}
          onOpenPath={(path) => void window.omnitermAPI?.app?.openInSystem?.(path)}
          onClose={() => setLinkMenu(null)}
        />
      )}

      {tabMenu && (
        <LaunchTabMenu
          x={tabMenu.x}
          y={tabMenu.y}
          run={tabMenu.run}
          preferredEditor={preferredEditor}
          browserUrl={resolveBrowserUrl(tabMenu.run)}
          hasAttach={Boolean(tabMenu.run.attach?.attachJson ?? tabMenu.run.attach?.wsUrl)}
          onStop={() => void stopRuns([tabMenu.run.runId])}
          onRestart={() => void restartRun(tabMenu.run.runId, tabMenu.run.mode)}
          onOpenInTerminal={() =>
            onOpenInTerminal({
              name: `Launch: ${tabMenu.run.name}`,
              cwd: tabMenu.run.cwd,
              terminalCommand: tabMenu.run.terminalCommand,
            })
          }
          onOpenBrowser={(url) => void openExternalUrl(url, api)}
          onOpenEditor={
            preferredEditor
              ? () => void api.openInEditor(tabMenu.run.cwd, preferredEditor)
              : undefined
          }
          onCopyAttachJson={
            tabMenu.run.attach?.attachJson ?? tabMenu.run.attach?.wsUrl
              ? () =>
                  void handleCopyAttachJson(
                    (tabMenu.run.attach?.attachJson ?? tabMenu.run.attach?.wsUrl)!,
                    tabMenu.x,
                    tabMenu.y,
                  )
              : undefined
          }
          onCopyLogs={() => void handleCopyLogs()}
          onClearLogs={() => clearBuffer(tabMenu.run.runId)}
          onCloseConsole={() => void closeTargetConsole(tabMenu.run.runId)}
          onClose={() => setTabMenu(null)}
        />
      )}
    </section>
  )
}

export default LaunchConsoleDrawer
