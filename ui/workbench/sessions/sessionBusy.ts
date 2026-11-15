import type { SessionStatus } from '@omniterm/contract'

/**
 * Whether closing a session would terminate something the user may care about. A connected local
 * shell already at its prompt has no child process to terminate, so closing it never asks.
 */
export function sessionCloseNeedsConfirm(
  status: SessionStatus | undefined,
  connType: string | undefined,
  busy: boolean | undefined,
): boolean {
  const state = status ?? 'closed'
  if (state !== 'connected' && state !== 'connecting') return false
  return !(state === 'connected' && connType === 'LOCAL' && busy === false)
}
