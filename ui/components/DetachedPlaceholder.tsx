import React from 'react'
import { ExternalLink, Minimize2 } from 'lucide-react'
import { detachTitle } from '../detachControl'

interface DetachedPlaceholderProps {
  name: string
  onFocus: () => void
  onReattach: () => void
  /** Rendered inside a split pane: smaller art, buttons stack instead of overflowing. */
  compact?: boolean
}

/**
 * Shown in the main window in place of a terminal that has been popped out into its own OS window.
 * The session keeps running (owned by the main process); this just offers to focus that window or
 * fold the session back into the tab. Sized in vmin (like WaitingPane) so a narrow split pane
 * shrinks the art and stacks the buttons instead of clipping or overflowing them.
 */
const DetachedPlaceholder: React.FC<DetachedPlaceholderProps> = ({ name, onFocus, onReattach, compact }) => (
  <div className={`detach-window-enter h-full w-full flex flex-col items-center justify-center text-theme-dim select-none bg-[var(--theme-bg)] ${compact ? 'gap-3 px-2' : 'gap-4'}`}>
    <ExternalLink className={compact ? 'w-[12vmin] min-w-[28px] max-w-[56px] opacity-20' : 'w-14 h-14 opacity-20'} />
    <div className="text-center min-w-0 max-w-full">
      <p className={`font-medium text-theme-fg ${compact ? 'text-xs' : 'text-sm'}`}>Running in a separate window</p>
      <p className="text-xs mt-1 opacity-70 truncate max-w-[80vw]">{name}</p>
    </div>
    <div className={`flex items-center ${compact ? 'flex-col gap-1.5' : 'gap-2'}`}>
      <button
        type="button"
        onClick={onFocus}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-border text-theme-fg text-xs hover:text-theme-accent hover:border-theme-accent transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        Focus window
      </button>
      <button
        type="button"
        onClick={onReattach}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-border text-theme-fg text-xs hover:text-theme-accent hover:border-theme-accent transition-colors"
        title={detachTitle('attach', 'footer')}
      >
        <Minimize2 className="w-3.5 h-3.5" />
        Attach back into this tab
      </button>
    </div>
  </div>
)

export default DetachedPlaceholder
