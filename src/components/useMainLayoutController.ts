import type { MainLayoutProps } from './mainLayoutShared'
import { useMainLayoutBase } from './useMainLayoutBase'
import { useMainLayoutSessions } from './useMainLayoutSessions'

export function useMainLayoutController(props: MainLayoutProps) {
  const base = useMainLayoutBase(props)
  const sessions = useMainLayoutSessions(base)
  return { ...base, ...sessions }
}

export type MainLayoutModel = ReturnType<typeof useMainLayoutController>
