import React from 'react'
import { Eye, FolderOpen, FolderGit2, MoonStar, Settings } from 'lucide-react'
import { Tooltip } from './Tooltip'

export type ActivityView = 'files' | 'workspace'

interface ActivityBarProps {
  /** Which secondary panel is active, or null when the panel is collapsed. */
  activeView: ActivityView | null
  /** Whether the Files view is available (requires a connected SSH session). */
  filesEnabled: boolean
  /** Called when the user clicks a view icon. Passing the currently-active view
   *  signals the panel should collapse; passing a different view switches to it
   *  (and expands the panel if it was collapsed). */
  onViewChange: (view: ActivityView | null) => void
  /** Opens the Settings modal. */
  onSettingsClick: () => void
  /** Always Awake is contributed by a plugin; without it the icon must not appear at all. */
  alwaysAwakeAvailable?: boolean
  alwaysAwakeEnabled?: boolean
  alwaysAwakeKeepingAwake?: boolean
  onAlwaysAwakeClick?: () => void
  blurAvailable?: boolean
  blurEnabled?: boolean
  onBlurClick?: () => void
}

/** A narrow icon rail (48 px) pinned to the left edge of the app — modelled after
 *  VS Code, Antigravity, and GitHub Copilot's "Activity Bar" pattern. */
const ActivityBar: React.FC<ActivityBarProps> = ({
  activeView,
  filesEnabled,
  onViewChange,
  onSettingsClick,
  alwaysAwakeAvailable = false,
  alwaysAwakeEnabled = false,
  alwaysAwakeKeepingAwake = false,
  onAlwaysAwakeClick = () => {},
  blurAvailable = false,
  blurEnabled = false,
  onBlurClick = () => {},
}) => {
  const handleIconClick = (view: ActivityView) => {
    if (view === 'files' && !filesEnabled) return
    // Clicking the active icon collapses the panel; clicking another one switches.
    onViewChange(activeView === view ? null : view)
  }

  return (
    <div className="activity-bar w-12 flex-shrink-0 flex flex-col items-center border-r border-[var(--theme-border)] select-none"
      style={{ backgroundColor: 'var(--theme-sidebar-bg)' }}
    >
      {/* ── Top icons ──────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-1 pt-2 w-full">
        {/* Workspace is always available (a built-in provider backs it), independent of any plugin. */}
        <ActivityIcon
          icon={<FolderGit2 className="w-5 h-5" />}
          label="Workspace"
          shortcut="Ctrl+B"
          active={activeView === 'workspace'}
          onClick={() => handleIconClick('workspace')}
        />
        <ActivityIcon
          icon={<FolderOpen className="w-5 h-5" />}
          label="Files"
          active={activeView === 'files'}
          disabled={!filesEnabled}
          onClick={() => handleIconClick('files')}
        />
      </div>

      {/* ── Bottom icons (pinned) ──────────────────────────────────── */}
      {/* Always Awake sits with Settings rather than with the panel views: it opens a modal and toggles
          a machine-wide setting, it does not switch the secondary panel. */}
      <div className="mt-auto flex flex-col items-center gap-1 pb-2 w-full">
        {blurAvailable && (
          <ActivityIcon
            icon={<Eye className="w-5 h-5" />}
            label={blurEnabled ? 'Blur inactive windows (on)' : 'Blur inactive windows'}
            active={blurEnabled}
            onClick={onBlurClick}
          />
        )}
        {alwaysAwakeAvailable && (
          <ActivityIcon
            icon={<MoonStar className="w-5 h-5" />}
            label={alwaysAwakeEnabled ? (alwaysAwakeKeepingAwake ? 'Always Awake (active)' : 'Always Awake (waiting)') : 'Always Awake'}
            active={alwaysAwakeEnabled}
            onClick={onAlwaysAwakeClick}
          />
        )}
        <ActivityIcon
          icon={<Settings className="w-5 h-5" />}
          label="Settings"
          shortcut="Ctrl+,"
          active={false}
          onClick={onSettingsClick}
        />
      </div>
    </div>
  )
}

/* ── Individual activity bar icon button ─────────────────────────────── */

const ActivityIcon: React.FC<{
  icon: React.ReactNode
  label: string
  shortcut?: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}> = ({ icon, label, shortcut, active, disabled, onClick }) => (
  <Tooltip content={label} shortcut={shortcut} placement="right">
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors
        ${disabled
          ? 'text-[var(--theme-dim)] opacity-30 cursor-not-allowed'
          : active
            ? 'text-[var(--theme-accent)] bg-[var(--theme-hover-bg)]'
            : 'text-[var(--theme-dim)] hover:text-[var(--theme-fg)] hover:bg-[var(--theme-hover-bg)]'
        }`}
    >
      {/* Active indicator bar — 2 px accent stripe on the left edge */}
      {active && (
        <div
          className="absolute left-0 top-1/4 w-[2px] h-1/2 rounded-r"
          style={{ backgroundColor: 'var(--theme-accent)' }}
        />
      )}
      {icon}
    </button>
  </Tooltip>
)

export default ActivityBar
