import { sessionDisplayName } from './sessionDisplayName'

/**
 * What a Sessions row reads. An agent: its profile and what it works on (the conversation's title
 * once saved, else the session's name), `claude-work – Fix the login bug`; a terminal: its name.
 */
export function sessionRowLabel(name: string, profile: string | null | undefined, title: string | null | undefined): string {
  const shown = title?.trim() || sessionDisplayName(name)
  if (!profile) return shown
  return shown && shown !== profile ? `${profile} – ${shown}` : profile
}
