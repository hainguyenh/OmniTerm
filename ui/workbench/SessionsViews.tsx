import { useAttachHost } from './sessionsHostCore'

/**
 * The shell's own tree is only dialogs and overlays (`position: fixed`), so its host sits in a
 * zero-size box that stays in the document, which keeps them visible and keeps the host from ever
 * being detached.
 */
export function DialogsSlot({ host }: { host: HTMLElement }) {
  const ref = useAttachHost<HTMLDivElement>(host)
  return <div ref={ref} style={{ position: 'absolute', width: 0, height: 0, overflow: 'visible' }} data-dialogs-slot />
}
