/** Claude's dialog for a folder whose settings pre-approve tools: bare options, cursor on "No". */
export const PERMISSIONS_TRUST = [
  ' ⚠ This folder pre-approves 23 tool permissions in .claude/settings.local.json:',
  '   PowerShell(git config *), PowerShell(git *), Bash(ls *), and 15 more',
  ' These will apply without asking. Only proceed if you trust this configuration.',
  '',
  ' Security guide',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
]

/** The same dialog after one Down arrow: the cursor is on the Yes option. */
export const PERMISSIONS_TRUST_ON_YES = PERMISSIONS_TRUST.map((line) => line
  .replace(' ❯ No, exit', '   No, exit')
  .replace('   Yes, I trust this folder', ' ❯ Yes, I trust this folder'))
