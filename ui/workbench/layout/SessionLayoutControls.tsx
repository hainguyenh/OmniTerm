import { PaneZoomControl } from '../../components/PaneZoomControl'
import FullscreenRestoreControl from '../../components/FullscreenRestoreControl'

import { applyEditorPreset, restoreMaximized } from './layoutPresetStore'
import { LayoutPresetPicker } from './LayoutPresetPicker'
import { useCurrentPreset, useMaximized, type ZoomModel } from './useLayoutPreset'

/** What sits at the top of the right stripe, above Notifications: the terminal zoom (grids only) and the layout picker. */
export function SessionLayoutControls({ zoom }: { zoom: ZoomModel }) {
  const preset = useCurrentPreset()
  return (
    <>
      {zoom.available && (
        <PaneZoomControl zoom={zoom.zoom} manual={zoom.manual} onStep={zoom.step} onAuto={zoom.auto} />
      )}
      <LayoutPresetPicker current={preset} onSelect={applyEditorPreset} />
    </>
  )
}

/** The way back from a maximized pane, shown over the editor (Escape does the same). */
export function MaximizedRestore() {
  const maximized = useMaximized()
  if (!maximized) return null
  return (
    <div className="fixed left-0 right-0 top-10 h-0 z-[1000]" data-testid="maximized-restore">
      <FullscreenRestoreControl onRestore={restoreMaximized} />
    </div>
  )
}
