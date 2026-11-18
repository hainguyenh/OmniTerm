import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

import clsx from 'clsx'

import { Icon, Popup, showContextMenu, type MenuItem } from '../../ide/ui'
import styles from '../../ide/features/welcome/ProjectPopup.module.css'

export interface PopupEntry {
  id: string
  label: string
  /** Secondary text after the label (counts, a path). */
  detail?: string
  /** Leading content: a badge or a radio mark; actions use `icon`. */
  lead?: ReactNode
  icon?: string
  checked?: boolean
  /** Starts a new section (separator, and a grey header when `header` is set). */
  header?: string
  run: () => void
  /** Right-click actions of this row. */
  menu?: MenuItem[]
}

interface TitlePopupListProps {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  label: string
  entries: readonly PopupEntry[]
  /** Grey caption above the first entry. */
  caption?: string
}

/**
 * A title bar dropdown in the project widget's popup style (`ProjectPopup`): grey section headers,
 * 24px rows, arrow keys and Enter. The workspace and project filter popups are built on it so they
 * look and behave like the upstream ones.
 */
export function TitlePopupList({ anchor, onClose, label, entries, caption }: TitlePopupListProps) {
  const [active, setActive] = useState(() => Math.max(0, entries.findIndex((entry) => entry.checked)))
  const listRef = useRef<HTMLDivElement>(null)
  const current = Math.min(active, entries.length - 1)

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const activate = (entry: PopupEntry | undefined) => {
    if (!entry) return
    onClose()
    entry.run()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const count = entries.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (count) setActive((current + (event.key === 'ArrowDown' ? 1 : count - 1)) % count)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : count - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      activate(entries[current])
    }
  }

  return (
    <Popup open anchor={anchor} onClose={onClose} role="dialog" aria-label={label} className={styles.popup}>
      <div ref={listRef} tabIndex={-1} data-autofocus onKeyDown={onKeyDown} className={styles.inner} role="listbox" aria-label={label}>
        {caption && <div className={styles.header}>{caption}</div>}
        {entries.map((entry, index) => (
          <div key={entry.id} className={styles.group}>
            {entry.header !== undefined && (
              <>
                {index > 0 && <div className={styles.separator} role="separator" />}
                {entry.header && <div className={styles.header}>{entry.header}</div>}
              </>
            )}
            <div
              role="option"
              aria-selected={index === current}
              aria-checked={entry.checked}
              data-index={index}
              data-popup-entry={entry.id}
              className={clsx(styles.row, index === current && styles.active)}
              onMouseMove={() => index !== current && setActive(index)}
              onClick={() => activate(entry)}
              onContextMenu={entry.menu?.length ? (event) => { event.preventDefault(); showContextMenu(event, entry.menu ?? []) } : undefined}
            >
              {entry.lead ?? (entry.icon && <Icon name={entry.icon} size={16} className={styles.actionIcon} />)}
              <span className={styles.label}>{entry.label}</span>
              {entry.detail && <span className={styles.branch}>{entry.detail}</span>}
              {entry.checked && <Icon name="check" size={14} className={styles.actionIcon} />}
            </div>
          </div>
        ))}
      </div>
    </Popup>
  )
}
