import { registerSessionDropHandler } from './sessionDrag'
import { registerSessionTabMenu } from './sessionTabMenu'
import { registerSessionToolbar } from './sessionToolbar'

/** Everything around the session tabs that is not the editor kind itself: toolbar action, tab menu and drop handler. */
export function registerSessionTabFeatures(): () => void {
  const disposers = [registerSessionToolbar(), registerSessionTabMenu(), registerSessionDropHandler()]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
