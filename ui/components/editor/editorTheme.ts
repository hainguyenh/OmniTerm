import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/**
 * The editor's look, written entirely against the app's `--theme-*` variables (see themeVars.ts).
 *
 * Nothing here is computed from the active theme, so the extension is built once and shared by every
 * editor: switching theme or dark/light mode only changes the variables, and every open editor — and
 * every hidden tab's saved state — follows without a reconfigure.
 */

const chrome = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--theme-fg)',
    backgroundColor: 'var(--theme-bg)',
    fontSize: 'var(--editor-font-size, 13px)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--theme-font-mono)',
    lineHeight: '1.6',
  },
  // The app assigns its UI font to every div/span; code and gutters must inherit the mono font.
  '.cm-content, .cm-content *, .cm-gutters, .cm-gutters *': {
    fontFamily: 'inherit',
  },
  '.cm-content': {
    padding: '8px 0',
    caretColor: 'var(--theme-cursor, var(--theme-fg))',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--theme-cursor, var(--theme-fg))',
  },
  // Must match the specificity of CodeMirror's own base rule to win over it.
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--theme-selection)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--theme-bg)',
    color: 'color-mix(in srgb, var(--theme-fg) 38%, var(--theme-bg))',
    borderRight: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--theme-accent) 5%, var(--theme-bg))',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--theme-bg)',
    color: 'var(--theme-fg)',
  },
  '.cm-line': {
    padding: '0 16px 0 10px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '42px',
    padding: '0 10px 0 12px',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--theme-accent) 22%, transparent)',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--theme-accent) 30%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--theme-accent) 60%, transparent)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--theme-warning) 30%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--theme-warning) 55%, transparent)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'color-mix(in srgb, var(--theme-accent) 10%, var(--theme-bg))',
    border: '1px solid color-mix(in srgb, var(--theme-accent) 35%, var(--theme-border))',
    borderRadius: '4px',
    color: 'var(--theme-accent)',
    padding: '1px 8px',
    cursor: 'pointer',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
    cursor: 'pointer',
  },
  '.editor-fold-marker': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderRadius: '3px',
    color: 'var(--theme-dim)',
  },
  '.editor-fold-marker:hover': {
    backgroundColor: 'var(--theme-hover-bg)',
    color: 'var(--theme-accent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--theme-sidebar-bg)',
    color: 'var(--theme-fg)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--theme-border)',
  },
  // The search panel's fields. The app styles every input globally; these keep them compact and
  // themed inside the panel.
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    fontSize: '12px',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--theme-bg)',
    color: 'var(--theme-fg)',
    border: '1px solid var(--theme-border)',
    borderRadius: '4px',
    padding: '2px 6px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--theme-hover-bg)',
    color: 'var(--theme-fg)',
    border: '1px solid var(--theme-border)',
    borderRadius: '4px',
  },
  '.cm-specialChar': {
    color: 'var(--theme-syntax-invalid)',
  },
})

const syntax = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--theme-syntax-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--theme-syntax-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--theme-syntax-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--theme-dim)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--theme-syntax-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--theme-syntax-type)' },
  { tag: [t.propertyName, t.attributeValue], color: 'var(--theme-syntax-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--theme-syntax-tag)' },
  { tag: [t.attributeName], color: 'var(--theme-syntax-attribute)' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName), t.labelName, t.special(t.variableName)], color: 'var(--theme-syntax-constant)' },
  { tag: t.heading, color: 'var(--theme-syntax-heading)', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: 'var(--theme-syntax-link)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: 'var(--theme-dim)' },
  { tag: t.invalid, color: 'var(--theme-syntax-invalid)' },
])

export const editorTheme = [chrome, syntaxHighlighting(syntax)]
