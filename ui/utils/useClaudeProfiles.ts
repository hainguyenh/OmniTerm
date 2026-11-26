import { useEffect } from 'react'

import { create } from 'zustand'

import { listAgentProfiles } from '../features/agent-quota/agentQuotaAPI'

import { claudeProfileChoices, DEFAULT_CLAUDE_CHOICE, type ClaudeProfileChoice } from './sessionQuickStart'

const useClaudeProfileStore = create<{ choices: ClaudeProfileChoice[] }>(() => ({ choices: [DEFAULT_CLAUDE_CHOICE] }))

/**
 * Scans the machine's Claude profiles and keeps the result for the menus that offer them. A menu
 * opens at once with the last result (the default alone before the first scan) and calls this to be
 * current the next time, so a new launcher shows up without ever delaying a click.
 */
export function refreshClaudeProfiles(): Promise<void> {
  return listAgentProfiles().then((profiles) => {
    useClaudeProfileStore.setState({ choices: claudeProfileChoices(profiles) })
  })
}

/** The profiles found by the last scan. */
export const currentClaudeProfiles = (): ClaudeProfileChoice[] => useClaudeProfileStore.getState().choices

/** The profiles as a hook; scans once when the component mounts. */
export function useClaudeProfiles(): ClaudeProfileChoice[] {
  const choices = useClaudeProfileStore((state) => state.choices)
  useEffect(() => {
    void refreshClaudeProfiles()
  }, [])
  return choices
}
