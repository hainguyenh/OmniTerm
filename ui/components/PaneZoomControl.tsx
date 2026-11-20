import React from 'react'

import { PANE_ZOOM_MAX, PANE_ZOOM_MIN } from '../utils/paneZoom'
import { Tooltip } from './Tooltip'

interface PaneZoomControlProps {
  zoom: number
  /** The user chose this zoom; otherwise it follows the window (automatic). */
  manual: boolean
  onStep: (direction: 1 | -1) => void
  /** Back to the zoom that follows the window. */
  onAuto: () => void
}

const button = 'w-[30px] h-5 inline-flex items-center justify-center rounded-[5px] text-[13px] leading-none text-[var(--fg-secondary)] hover:bg-[var(--bg-toolbar-hover)] disabled:opacity-30'

/**
 * Terminal zoom of a grid layout (workbench layout `.zbtn` / `.zpct`): + / percentage /
 * −, on the right stripe above the layout picker. It shrinks the font with the pane (automatic);
 * the buttons step it and a double click on the percentage hands it back to the window.
 */
export const PaneZoomControl: React.FC<PaneZoomControlProps> = ({ zoom, manual, onStep, onAuto }) => (
  <div className="flex flex-col items-center" data-testid="pane-zoom">
    <Tooltip content="Zoom in" placement="left">
      <button type="button" aria-label="Zoom panes in" className={button} disabled={zoom >= PANE_ZOOM_MAX} onClick={() => onStep(1)}>
        +
      </button>
    </Tooltip>
    <Tooltip content={manual ? 'Set by you. Double click to follow the window size' : 'Follows the window size'} placement="left">
      <span
        className="text-[9.5px] text-[var(--fg-muted)] tabular-nums select-none cursor-default"
        aria-label="Pane zoom"
        data-manual={manual ? '' : undefined}
        onDoubleClick={onAuto}
      >
        {Math.round(zoom * 100)}%
      </span>
    </Tooltip>
    <Tooltip content="Zoom out" placement="left">
      <button type="button" aria-label="Zoom panes out" className={button} disabled={zoom <= PANE_ZOOM_MIN} onClick={() => onStep(-1)}>
        −
      </button>
    </Tooltip>
  </div>
)
