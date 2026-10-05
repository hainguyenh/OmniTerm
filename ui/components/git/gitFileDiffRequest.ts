/** A request to show one file's diff in the Git view, optionally against another branch. */
export interface FileDiffRequest {
  path: string
  targetBranch?: string
}

// The Git view is mounted only while it is the active sidebar view, so a request made from
// elsewhere (the footer's branch popup) is parked here until the view mounts and takes it.
let pending: FileDiffRequest | null = null

/** Open the Git view and show `request` there, whether or not the view is mounted yet. */
export function requestFileDiff(request: FileDiffRequest): void {
  pending = request
  window.dispatchEvent(new CustomEvent('omniterm:open-git'))
  window.dispatchEvent(new CustomEvent('omniterm:open-file-diff', { detail: request }))
}

/** The parked request, if any — cleared so it is shown once. */
export function takePendingFileDiff(): FileDiffRequest | null {
  const request = pending
  pending = null
  return request
}
