/** Only the control presentation changes; CodeMirror owns the existing edit/fold actions. */
export function renderRevertControl() {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'diff-restore-chunk'
  button.title = 'Revert this chunk to the base version · Ctrl+Z to undo'
  button.setAttribute('aria-label', 'Revert this chunk to the base version')
  button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15.5-6.5L3 13"/></svg><span>Revert</span>'
  return button
}

export function renderFoldMarker(open: boolean) {
  const marker = document.createElement('span')
  marker.className = 'editor-fold-marker'
  marker.title = open ? 'Fold code block' : 'Expand code block'
  marker.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="${open ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'}"/></svg>`
  return marker
}

export function renderFoldPlaceholder(onClick: (event: Event) => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'cm-foldPlaceholder'
  button.textContent = '… folded code'
  button.title = 'Expand folded code block'
  button.setAttribute('aria-label', 'Expand folded code block')
  button.addEventListener('click', onClick)
  return button
}
