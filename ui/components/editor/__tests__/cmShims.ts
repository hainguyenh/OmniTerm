/**
 * jsdom has no layout engine; CodeMirror measures text ranges while it renders. These stubs return
 * empty geometry so a real `EditorView` can mount, take input and be destroyed in tests.
 */
export function installCodeMirrorShims(): void {
  const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })
  const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: emptyRects })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: emptyRect })
  if (!document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null })
  }
}
