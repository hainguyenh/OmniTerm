/** Where a dialog sits without its drag offset, and its size, in client pixels. */
export interface DialogBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DialogOffset {
  x: number;
  y: number;
}

/**
 * The drag offset nearest to `offset` that keeps the whole dialog inside the
 * window (below `minTop`, such as an overlay title bar). A dialog larger than
 * the window keeps its top-left corner visible.
 */
export function clampDialogOffset(
  offset: DialogOffset,
  box: DialogBox,
  viewport: { width: number; height: number },
  minTop = 0,
): DialogOffset {
  const x = Math.max(Math.min(offset.x, viewport.width - box.left - box.width), -box.left);
  const y = Math.max(Math.min(offset.y, viewport.height - box.top - box.height), minTop - box.top);
  return x === offset.x && y === offset.y ? offset : { x, y };
}
