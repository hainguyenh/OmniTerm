import { Icon } from '../../ide/ui'

import { AWAKE_ICON } from './awakeIcon'
import { awakeLabel, openAlwaysAwake, useAwakeIndicator } from './awakeIndicatorStore'
import './awakeStripe.css'

/**
 * The Always Awake button on the right stripe, right under Notifications: opens its dialog. Coloured
 * while the user has it on; a dot shows it is keeping the machine awake right now. Absent while the
 * built-in feature is off in Plugins.
 */
export function AwakeStripeButton({ side }: { side: 'left' | 'right' }) {
  const { available, enabled, keepingAwake } = useAwakeIndicator()
  if (side !== 'right' || !available) return null
  const label = awakeLabel({ enabled, keepingAwake })
  return (
    <button
      type="button"
      className="omt-awake-stripe"
      aria-label={label}
      aria-pressed={enabled}
      title={label}
      onClick={openAlwaysAwake}
      data-testid="awake-stripe-button"
    >
      <Icon name={AWAKE_ICON} size={16} />
      {enabled && keepingAwake && <span className="omt-awake-stripe-dot" aria-hidden="true" />}
    </button>
  )
}
