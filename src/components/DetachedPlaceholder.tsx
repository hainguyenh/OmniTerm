import React from 'react'
import { ExternalLink, Minimize2 } from 'lucide-react'
import { detachTitle } from '../detachControl'

interface DetachedPlaceholderProps {
  name: string
  onFocus: () => void
  onReattach: () => void
}

/**
 * Shown in the main window in place of a terminal that has been popped out into its own OS window.
 * The session keeps running (owned by the main process); this just offers to focus that window or
 * fold the session back into the tab.
 */
const DetachedPlaceholder: React.FC<DetachedPlaceholderProps> = ({ name, onFocus, onReattach }) => (
  <div className="h-full w-full flex flex-col items-center justify-center gap-4 text-theme-dim select-none bg-[var(--theme-bg)]">
    <ExternalLink className="w-14 h-14 opacity-20" />
    <div className="text-center">
      <p className="text-sm font-medium text-theme-fg">Running in a separate window</p>
      <p className="text-xs mt-1 opacity-70 truncate max-w-[80vw]">{name}</p>
    </div>
    <div className="flex items-center gap-2">
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
