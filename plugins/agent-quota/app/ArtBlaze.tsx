import type React from 'react'

/**
 * Blazing flame effect rendered when quota >= 90% during icon tier loading.
 * Renders fire burning at the runner position and a fire trail behind it along the path.
 */
export function ArtBlaze(): React.ReactElement {
  return (
    <span className="aq-art-blaze" aria-hidden="true" data-testid="aq-art-blaze">
      <span className="aq-art-fire-trail">
        <span className="aq-art-trail-ground" />
        <span className="aq-art-trail-flame aq-trail-flame-1" />
        <span className="aq-art-trail-flame aq-trail-flame-2" />
        <span className="aq-art-trail-flame aq-trail-flame-3" />
      </span>
      <span className="aq-art-fire-runner">
        <span className="aq-art-runner-glow" />
        <span className="aq-art-runner-flame aq-runner-flame-back" />
        <span className="aq-art-runner-flame aq-runner-flame-front" />
        <span className="aq-art-runner-spark aq-spark-1" />
        <span className="aq-art-runner-spark aq-spark-2" />
        <span className="aq-art-runner-spark aq-spark-3" />
      </span>
    </span>
  )
}
