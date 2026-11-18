import { registerExternalIcons } from '../../ide/ui'
import { registerStripeItem } from '../../ide/workbench/toolwindows/stripeItems'

import { AWAKE_ICON, AWAKE_SVG } from './awakeIcon'
import { AwakeStripeButton } from './AwakeStripeButton'

/** Registers the Always Awake icon and stripe button; the returned function removes both. */
export function registerAwakeStripe(): () => void {
  const disposers = [
    registerExternalIcons([[AWAKE_ICON, AWAKE_SVG]]),
    // Before the quota status line, so it sits directly under the right stripe's top group.
    registerStripeItem({ id: 'omniterm.alwaysAwake.stripe', order: -1, component: AwakeStripeButton }),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
