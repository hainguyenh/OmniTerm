import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { iconForAgent, type AgentBrand } from '../../features/agent-quota/agentBrand'
import { registerExternalIcons } from '../../ide/ui/icons'
import { notifyTabTitlesChanged } from '../../ide/workbench/contributions'
import { agentBrandFor } from '../../utils/agentIdentity'
import { getPanePresence, subscribePanePresence } from '../../utils/agentPresenceStore'
import type { QuickStartAgent } from '../../utils/sessionQuickStart'

import { useSessionBridge } from './sessionBridge'

const BRANDS: readonly AgentBrand[] = ['claude', 'codex', 'gemini', 'agy', 'opencode', 'copilot']
const iconName = (brand: AgentBrand) => `ext:omniterm/agent-${brand}`

const PAINT_ATTRS = /\s(fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)="[^"]*"/g

/**
 * The editor's icon set keeps only what is inside an `<svg>`: paint set on the root element (as
 * lucide icons do: `stroke="currentColor"`, `fill="none"`) moves onto a group around the content,
 * otherwise the icon draws nothing.
 */
export function paintOnGroup(svg: string): string {
  const match = /^<svg([^>]*)>([\s\S]*)<\/svg>$/.exec(svg.trim())
  if (!match) return svg
  const [, attrs = '', inner = ''] = match
  const paint = attrs.match(PAINT_ATTRS)?.join('') ?? ''
  if (!paint) return svg
  return `<svg${attrs.replace(PAINT_ATTRS, '')}><g${paint}>${inner}</g></svg>`
}

/** The tab icon of a session: its agent's brand while an agent runs in it, else the terminal glyph. */
export function sessionIconName(sessionId: string | null): string {
  const brand = sessionId ? agentBrandFor(getPanePresence(sessionId)?.agent) : null
  return brand ? iconName(brand) : 'terminal'
}

/** The icon of a session picker choice: the agent's brand (as its tabs show it), or the terminal glyph. */
export function quickStartAgentIconName(agent: QuickStartAgent): string {
  if (!agent.command) return 'terminal'
  const brand = agentBrandFor(agent.id)
  return brand ? iconName(brand) : (agent.icon ?? `agent-${agent.id}`)
}

/**
 * Registers the agent brand icons (the ones the Sessions panel and the headers use) with the
 * editor's icon set, and refreshes the tab icons when a session's agent appears or goes.
 */
export function registerAgentTabIcons(): () => void {
  const stopIcons = registerExternalIcons(
    BRANDS.map((brand) => [iconName(brand), paintOnGroup(renderToStaticMarkup(createElement(iconForAgent(brand), { className: '' })))] as const),
  )
  let signature = ''
  const refresh = () => {
    const next = useSessionBridge.getState().sessions.map((session) => `${session.id}:${sessionIconName(session.id)}`).join('|')
    if (next === signature) return
    signature = next
    notifyTabTitlesChanged()
  }
  const stops = [subscribePanePresence(refresh), useSessionBridge.subscribe(refresh)]
  return () => {
    stops.forEach((stop) => stop())
    stopIcons()
  }
}
