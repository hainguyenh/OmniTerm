import type { MainLayoutModel } from '../../components/useMainLayoutController'
import { MaximizedRestore, SessionLayoutControls } from '../layout/SessionLayoutControls'
import { useLayoutPresetEffects, useSessionZoomModel } from '../layout/useLayoutPreset'
import { QuotaStripVertical } from '../QuotaStripVertical'
import { StripePortal } from '../StripePortal'

import { SessionSurfaces } from './SessionSurfaces'

/**
 * What the shell keeps while every session is an editor tab: the sessions' terminals (portalled
 * into their tab surfaces, zoomed with the layout), the layout controls at the top of the right stripe and the
 * window-level layout wiring.
 */
export function SessionTabsShell({ model }: { model: MainLayoutModel }) {
  useLayoutPresetEffects(true)
  const zoom = useSessionZoomModel()
  return (
    <>
      <SessionSurfaces model={model} zoom={zoom.zoom} />
      {/* The layout picker sits above Notifications, the first button of the right stripe. */}
      <StripePortal side="right" at="top">
        <SessionLayoutControls zoom={zoom} />
      </StripePortal>
      <StripePortal side="right">
        <QuotaStripVertical />
      </StripePortal>
      <MaximizedRestore />
    </>
  )
}
