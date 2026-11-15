import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { SessionPaneContent } from '../../components/SessionPaneContent'
import type { MainLayoutModel } from '../../components/useMainLayoutController'

import { disposeSurface, surfaceHost, useSurfaceState } from './surfaceRegistry'

function SessionSurface({
  model,
  tab,
  blurAvailable,
  zoom,
}: {
  model: MainLayoutModel
  tab: { id: string; connId: string; name: string }
  blurAvailable: boolean
  zoom: number
}) {
  const state = useSurfaceState((all) => all[tab.id])
  return createPortal(
    <SessionPaneContent
      model={model}
      tab={tab}
      active={!!state?.attached && state.shown}
      layoutEpoch={`surface:${state?.epoch ?? 0}`}
      zoom={zoom}
      blurAvailable={blurAvailable}
      onNewSession={() => model.requestNewSession(undefined, model.selectedWorkspaceId)}
    />,
    surfaceHost(tab.id),
  )
}

/**
 * Renders every session's terminal once, into the session's own surface host through a portal, so
 * the React parent of a terminal never changes while its tab moves between panes, splits or
 * workspaces. Mounted once, inside the persistent shell of the workbench frame.
 */
export function SessionSurfaces({ model, blurAvailable, zoom }: { model: MainLayoutModel; blurAvailable: boolean; zoom: number }) {
  const tabs = model.activeTabs.filter((tab) => !model.editorTabs[tab.id])
  const previous = useRef<Set<string>>(new Set())
  const ids = tabs.map((tab) => tab.id).join('\u0000')
  useEffect(() => {
    const current = new Set(ids ? ids.split('\u0000') : [])
    // The session is gone for good: its surface (and the unmounted terminal in it) is dropped.
    for (const id of previous.current) if (!current.has(id)) disposeSurface(id)
    previous.current = current
  }, [ids])
  return (
    <>
      {tabs.map((tab) => (
        <SessionSurface key={tab.id} model={model} tab={tab} blurAvailable={blurAvailable} zoom={zoom} />
      ))}
    </>
  )
}
