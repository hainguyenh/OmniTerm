import { showToolWindow, slotOfId } from '../ide/workbench/toolwindows/store'

/**
 * Brings up the workbench's version control window: Commit when the non-modal commit interface is
 * on (its Local Changes live there), otherwise the Git log window. Returns false when the VCS
 * feature has not registered either (the workbench is off or still starting).
 */
export function openGitToolWindow(): boolean {
  const id = slotOfId('commit') ? 'commit' : slotOfId('git') ? 'git' : null
  if (!id) return false
  showToolWindow(id, true)
  return true
}
