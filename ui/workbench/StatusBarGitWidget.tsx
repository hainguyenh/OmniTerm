import { showBranchesPopupFromStatus } from '../ide/features/vcs/BranchWidget'
import { focusRepo } from '../ide/features/vcs/store'
import { BarButton, Icon } from '../ide/ui'

import { useFooterGit } from './useFooterGit'

/**
 * Status bar Git widget (bottom right): the branch of the repository the active file, terminal or
 * AI agent belongs to (see `useFooterGit`). A repository of the project opens the Branches popup
 * above it; one outside the project is shown for reference only.
 */
export function StatusBarGitWidget() {
  const git = useFooterGit()
  if (!git) return null
  const name = git.head ?? git.headCommit?.slice(0, 8) ?? 'No commits'
  const sync = [git.behind > 0 ? `↓${git.behind}` : '', git.ahead > 0 ? `↑${git.ahead}` : ''].filter(Boolean).join(' ')
  const tooltip = [`Repository: ${git.repo}`, `Git branch: ${name}`, git.inProject ? '' : 'Outside the project'].filter(Boolean).join('\n')
  return (
    <BarButton
      tooltip={tooltip}
      onClick={git.inProject ? () => void focusRepo(git.root).then(showBranchesPopupFromStatus) : undefined}
      data-status-branches-widget=""
      data-testid="status-bar-git-widget"
    >
      <Icon name={git.head ? 'branch' : 'commit'} size={14} />
      <span>{name}</span>
      {sync && <span aria-hidden="true">{sync}</span>}
    </BarButton>
  )
}
