/**
 * Keeps Windows TSF composition on a single input path.
 *
 * xterm 5.5 treats its hidden textarea as both the IME document and the pending keyboard buffer.
 * Windows Telex can update that textarea as a whole value, while xterm also handles the same
 * keydown/input sequence. The two paths then replay already-sent text when a delimiter ends the
 * composition. Own the composition events here, like a normal text field, and commit them once.
 */
interface ImeTerminal {
  readonly element: HTMLElement | undefined
  readonly textarea: HTMLTextAreaElement | undefined
  input(data: string): void
}

export interface WindowsImeWorkaround {
  dispose(): void
  shouldForwardData(data: string): boolean
}

const getCompositionBoundaryInput = (event: KeyboardEvent): string | undefined => {
  if (event.key === 'Enter') return '\r'
  if (event.key === 'Tab') return '\t'
  if (event.key === 'Backspace') return '\x7f'
  if (event.key === 'Escape') return '\x1b'
  if (event.key.length === 1 && !/[A-Za-z0-9]/.test(event.key)) return event.key
  if (event.keyCode === 32) return ' '
  if (event.keyCode === 189 || event.code === 'Minus') return '-'
  return undefined
}

const pendingCompositionText = (base: string, composition: string): string => {
  if (base.length === 0 || composition.length === 0) return composition
  if (composition.startsWith(base)) return composition.slice(base.length)
  if (base.startsWith(composition) || base.endsWith(composition)) return ''

  let commonLength = 0
  while (commonLength < base.length && commonLength < composition.length
    && base[commonLength] === composition[commonLength]) {
    commonLength += 1
  }
  return commonLength > 0 ? composition.slice(commonLength) : composition
}

export const installWindowsImeCompositionWorkaround = (
  terminal: ImeTerminal,
  enabled: boolean,
): WindowsImeWorkaround => {
  const element = terminal.element
  const textarea = terminal.textarea
  if (!enabled || !element || !textarea) {
    return {
      dispose: () => {},
      shouldForwardData: () => true,
    }
  }

  const compositionView = element.querySelector<HTMLElement>('.composition-view')
  const syncCompositionPreviewPosition = (): void => {
    if (!compositionView) return
    compositionView.style.left = textarea.style.left
    compositionView.style.top = textarea.style.top
    compositionView.style.height = textarea.style.height
    compositionView.style.lineHeight = textarea.style.lineHeight
  }

  const setCompositionPreview = (text: string): void => {
    if (!compositionView) return
    syncCompositionPreviewPosition()
    compositionView.textContent = text
    compositionView.classList.toggle('active', text.length > 0)
    compositionView.style.display = text.length > 0 ? 'block' : 'none'
    compositionView.style.userSelect = 'none'
    compositionView.style.textDecoration = 'none'
    compositionView.style.pointerEvents = 'none'
  }

  const updateCompositionPreview = (data: string): void => {
    compositionText = data
    setCompositionPreview(pendingCompositionText(compositionBase, data))
  }

  const liveCompositionData = (fallback: string): string =>
    textarea.value.length > 0 && textarea.value !== compositionBase
      ? textarea.value
      : fallback

  let compositionActive = false
  let compositionBase = ''
  let compositionText = ''
  let suppressNextCompositionEnd = false
  let suppressNextInput = false
  let suppressInputResetTimer: number | undefined
  let expectedDuplicates: string[] = []
  let expectedDuplicateResetTimer: number | undefined
  let sendingOwnCommit = false

  const clearCompositionBuffer = (): void => {
    textarea.value = ''
    textarea.setSelectionRange(0, 0)
  }

  const armInputSuppression = (): void => {
    suppressNextInput = true
    if (suppressInputResetTimer !== undefined) window.clearTimeout(suppressInputResetTimer)
    suppressInputResetTimer = window.setTimeout(() => {
      suppressNextInput = false
      suppressInputResetTimer = undefined
    }, 0)
  }

  const rememberExpectedDuplicates = (data: string, pendingText: string, suffix: string): void => {
    expectedDuplicates = [...new Set([data, pendingText, suffix].filter(value => value.length > 0))]
    if (expectedDuplicateResetTimer !== undefined) window.clearTimeout(expectedDuplicateResetTimer)
    expectedDuplicateResetTimer = expectedDuplicates.length > 0
      ? window.setTimeout(() => {
          expectedDuplicates = []
          expectedDuplicateResetTimer = undefined
        }, 100)
      : undefined
  }

  const clearExpectedDuplicates = (): void => {
    expectedDuplicates = []
    if (expectedDuplicateResetTimer !== undefined) {
      window.clearTimeout(expectedDuplicateResetTimer)
      expectedDuplicateResetTimer = undefined
    }
  }

  const finishComposition = (data: string, suffix = ''): void => {
    const pendingText = pendingCompositionText(compositionBase, data)
    compositionActive = false
    compositionBase = ''
    compositionText = ''
    setCompositionPreview('')
    clearCompositionBuffer()
    suppressNextCompositionEnd = suffix.length > 0
    armInputSuppression()
    const commit = pendingText + suffix
    if (commit.length > 0) {
      rememberExpectedDuplicates(commit, pendingText, suffix)
      sendingOwnCommit = true
      try {
        terminal.input(commit)
      } finally {
        sendingOwnCommit = false
      }
    }
  }

  const onCompositionStart = (event: CompositionEvent): void => {
    if (event.target !== textarea) return
    compositionActive = true
    compositionBase = textarea.value
    compositionText = ''
    suppressNextCompositionEnd = false
    suppressNextInput = false
    setCompositionPreview('')
    // xterm must not initialize its offset-based CompositionHelper for this composition.
    event.stopPropagation()
  }

  const onCompositionUpdate = (event: CompositionEvent): void => {
    if (event.target !== textarea) return
    // Chromium sometimes reports the whole composition in the textarea while `data` only carries
    // the latest edit. Prefer the textarea value so the preview follows the IME document exactly;
    // the event data remains the fallback for browsers/tests that do not update the value first.
    updateCompositionPreview(liveCompositionData(event.data))
    event.stopPropagation()
  }

  const onCompositionEnd = (event: CompositionEvent): void => {
    if (event.target !== textarea) return
    event.stopPropagation()
    if (suppressNextCompositionEnd) {
      suppressNextCompositionEnd = false
      armInputSuppression()
      compositionActive = false
      compositionBase = ''
      compositionText = ''
      setCompositionPreview('')
      clearCompositionBuffer()
      return
    }
    if (!compositionActive) return
    finishComposition(compositionText || event.data)
  }

  const onInput = (event: Event): void => {
    if (event.target !== textarea) return
    if (compositionActive) {
      const inputEvent = event as InputEvent
      // Windows Telex can deliver the live pre-edit text through `input` without a useful
      // compositionupdate payload. Keep it visible, but never let this intermediate value reach
      // xterm/PTY until compositionend or a delimiter commits it. This also handles Backspace:
      // the textarea value is the source of truth after the IME removes a character.
      updateCompositionPreview(liveCompositionData(inputEvent.data ?? ''))
      event.stopPropagation()
      return
    }
    if (suppressNextInput) {
      event.stopPropagation()
      suppressNextInput = false
      if (suppressInputResetTimer !== undefined) {
        window.clearTimeout(suppressInputResetTimer)
        suppressInputResetTimer = undefined
      }
      return
    }
    clearExpectedDuplicates()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== textarea) return
    if (!compositionActive) {
      clearExpectedDuplicates()
      return
    }

    if (event.key === 'Backspace' && compositionText.length > 0) {
      // Backspace edits the native IME document. Committing the current composition here would
      // replay the whole pre-edit string before the IME has applied the deletion.
      event.stopPropagation()
      return
    }

    const suffix = getCompositionBoundaryInput(event)
    if (suffix !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      finishComposition(compositionText, suffix)
      return
    }

    // Keep every other key in the browser IME. xterm's keydown handler must not emit its stale
    // textarea diff while Telex is still building the composition.
    event.stopPropagation()
  }

  const shouldForwardData = (data: string): boolean => {
    if (data.length === 0) return true
    if (sendingOwnCommit) return true
    if (compositionActive) return false
    if (expectedDuplicates.length === 0) return true
    const candidateIndex = expectedDuplicates.findIndex(candidate => data === candidate
      || data === `${candidate}${candidate}`
      || candidate.startsWith(data))
    if (candidateIndex < 0) return true
    const candidate = expectedDuplicates[candidateIndex]
    if (candidate.startsWith(data) && candidate !== data) {
      expectedDuplicates[candidateIndex] = candidate.slice(data.length)
    } else {
      expectedDuplicates.splice(candidateIndex, 1)
    }
    if (expectedDuplicateResetTimer !== undefined) {
      window.clearTimeout(expectedDuplicateResetTimer)
      expectedDuplicateResetTimer = undefined
    }
    if (expectedDuplicates.length > 0) {
      expectedDuplicateResetTimer = window.setTimeout(() => {
        expectedDuplicates = []
        expectedDuplicateResetTimer = undefined
      }, 100)
    }
    return false
  }

  element.addEventListener('compositionend', onCompositionEnd, true)
  element.addEventListener('compositionstart', onCompositionStart, true)
  element.addEventListener('compositionupdate', onCompositionUpdate, true)
  element.addEventListener('input', onInput, true)
  element.addEventListener('keydown', onKeyDown, true)
  const dispose = (): void => {
    if (suppressInputResetTimer !== undefined) window.clearTimeout(suppressInputResetTimer)
    if (expectedDuplicateResetTimer !== undefined) window.clearTimeout(expectedDuplicateResetTimer)
    setCompositionPreview('')
    element.removeEventListener('compositionend', onCompositionEnd, true)
    element.removeEventListener('compositionstart', onCompositionStart, true)
    element.removeEventListener('compositionupdate', onCompositionUpdate, true)
    element.removeEventListener('input', onInput, true)
    element.removeEventListener('keydown', onKeyDown, true)
  }
  return { dispose, shouldForwardData }
}
