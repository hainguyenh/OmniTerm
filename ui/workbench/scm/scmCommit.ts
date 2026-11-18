import { refreshNow } from '../../ide/features/vcs/store'
import { call, commands } from '../../ide/platform/ipc'
import { notifications } from '../../ide/workbench/contributions'

import { committablePaths, type ScmSection } from './scmModel'
import { useScmDrafts } from './scmStore'

/**
 * Commits every change of one repository with the message typed for it. Other repositories of the
 * workspace are not touched. Resolves true when a commit was made.
 */
export async function commitSection(section: ScmSection): Promise<boolean> {
  const drafts = useScmDrafts.getState()
  const message = (drafts.messages[section.root] ?? '').trim()
  const stage = committablePaths(section)
  if (!message || stage.length === 0 || drafts.busy) return false
  drafts.setBusy(section.root)
  try {
    await call(commands.vcsCommit(section.root, message, { amend: false, signOff: false, author: null, runHooks: true, stage }))
    useScmDrafts.getState().setMessage(section.root, '')
    await refreshNow()
    return true
  } catch (error) {
    notifications().notify({
      level: 'error',
      title: `Could not commit ${section.name}`,
      body: error instanceof Error ? error.message : String(error),
      key: `scm.commit.${section.root}`,
    })
    return false
  } finally {
    useScmDrafts.getState().setBusy(null)
  }
}
