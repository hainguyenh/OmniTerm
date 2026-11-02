import type { ReactNode } from 'react'

import { isTerminalLinkModifierClick } from '../../../ui/utils/terminalLinks'
import { parseAnsiSegments } from './ansiParser'

const URL_REGEX = /\bhttps?:\/\/[^\s<>'"`]+/gi
const TRAILING_PUNCT_REGEX = /[),.;:!?\]}]+$/

export interface AnsiLineProps {
  text: string
  onLinkAction?: (menu: { x: number; y: number; kind: 'url'; text: string }) => void
  onOpenUrl?: (url: string) => void
  onCopySelection?: (text: string) => void
}

function renderTextWithLinks(
  text: string,
  onLinkAction?: AnsiLineProps['onLinkAction'],
  onOpenUrl?: AnsiLineProps['onOpenUrl'],
  onCopySelection?: AnsiLineProps['onCopySelection'],
): ReactNode {
  const parts: ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(URL_REGEX)) {
    const rawMatch = match[0]
    const matchIndex = match.index ?? 0
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex))
    }

    const trailingPunct = rawMatch.match(TRAILING_PUNCT_REGEX)?.[0] ?? ''
    const cleanUrl = trailingPunct ? rawMatch.slice(0, -trailingPunct.length) : rawMatch

    parts.push(
      <a
        key={`${matchIndex}-${cleanUrl}`}
        href={cleanUrl}
        onClick={(e) => {
          e.preventDefault()
          if (isTerminalLinkModifierClick(e.nativeEvent)) {
            onLinkAction?.({ x: e.clientX, y: e.clientY, kind: 'url', text: cleanUrl })
          } else {
            onOpenUrl?.(cleanUrl)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const selection = window.getSelection()?.toString()
          if (selection) {
            onCopySelection?.(selection)
          } else {
            onLinkAction?.({ x: e.clientX, y: e.clientY, kind: 'url', text: cleanUrl })
          }
        }}
        title="Ctrl+click to open link menu"
        className="underline underline-offset-2 text-theme-accent hover:text-theme-fg cursor-pointer transition-colors"
      >
        {cleanUrl}
      </a>,
    )

    if (trailingPunct) {
      parts.push(trailingPunct)
    }

    lastIndex = matchIndex + rawMatch.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

export function AnsiLine({ text, onLinkAction, onOpenUrl, onCopySelection }: AnsiLineProps) {
  const segments = parseAnsiSegments(text)
  return (
    <>
      {segments.map((segment, index) => {
        const content = renderTextWithLinks(segment.text, onLinkAction, onOpenUrl, onCopySelection)
        return segment.className ? (
          <span key={index} className={segment.className}>
            {content}
          </span>
        ) : (
          <span key={index}>{content}</span>
        )
      })}
    </>
  )
}

export default AnsiLine
