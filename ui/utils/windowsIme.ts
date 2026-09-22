/**
 * Works around xterm 5.5's Windows TSF composition bug.
 *
 * Windows IMEs can replace the whole hidden textarea while committing a composition. xterm's
 * offset-based extraction then treats already-sent text as part of the composition and drops the
 * leading Vietnamese characters. Keep the composition preview visible while the IME is active,
 * then let xterm finish against an empty textarea and forward the commit string exactly once.
 */
interface ImeTerminal {
  readonly element: HTMLElement | undefined
  readonly textarea: HTMLTextAreaElement | undefined
  input(data: string): void
}

export const installWindowsImeCompositionWorkaround = (
  terminal: ImeTerminal,
  enabled: boolean,
): (() => void) => {
  const element = terminal.element
  const textarea = terminal.textarea
  if (!enabled || !element || !textarea) return () => {}

  const compositionView = element.querySelector<HTMLElement>('.composition-view')
  const setCompositionPreview = (text: string): void => {
    if (!compositionView) return
    compositionView.textContent = text
    compositionView.classList.toggle('active', text.length > 0)
  }

  let releasingCompositionEnd = false
  const onCompositionStart = (event: CompositionEvent): void => {
    if (event.target !== textarea) return
    setCompositionPreview('')
  }

  const onCompositionUpdate = (event: CompositionEvent): void => {
    if (event.target !== textarea) return
    setCompositionPreview(event.data)
  }

  const onCompositionEnd = (event: CompositionEvent): void => {
    if (event.target !== textarea) return
    setCompositionPreview('')
    if (releasingCompositionEnd || event.data.length === 0) return

    event.preventDefault()
    event.stopPropagation()

    // xterm's CompositionHelper must observe a compositionend to leave its composing state, but
    // its deferred offset extraction must see no stale text or it can emit a duplicate/truncated
    // commit. Dispatch a second, empty compositionend after clearing the helper textarea.
    textarea.value = ''
    textarea.setSelectionRange(0, 0)
    releasingCompositionEnd = true
    try {
      textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    } finally {
      releasingCompositionEnd = false
    }

    terminal.input(event.data)
  }

  element.addEventListener('compositionend', onCompositionEnd, true)
  element.addEventListener('compositionstart', onCompositionStart, true)
  element.addEventListener('compositionupdate', onCompositionUpdate, true)
  return () => {
    setCompositionPreview('')
    element.removeEventListener('compositionend', onCompositionEnd, true)
    element.removeEventListener('compositionstart', onCompositionStart, true)
    element.removeEventListener('compositionupdate', onCompositionUpdate, true)
  }
}
