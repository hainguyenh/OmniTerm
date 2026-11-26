import { IconButton } from '../../ide/ui'

import { useAvailableUpdate } from './availableUpdate'

/** Title bar: a green download mark while an update is available; it brings the update balloon back. */
export function UpdateTitleIndicator() {
  const update = useAvailableUpdate((s) => s.update)
  const onOpen = useAvailableUpdate((s) => s.onOpen)
  if (!update) return null
  return (
    <IconButton
      icon="download"
      iconSize={16}
      title={`Update available — v${update.version}`}
      data-testid="title-update-indicator"
      className="[--icon-color:var(--success)]"
      style={{ width: 26, height: 26 }}
      onClick={() => onOpen?.(update)}
    />
  )
}
