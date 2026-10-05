import { EditorView } from '@codemirror/view'

/**
 * Merge-view colors written against the app's `--theme-*` variables, replacing @codemirror/merge's
 * fixed light/dark palette so the diff follows every theme the way the editor itself does.
 */
export const diffTheme = EditorView.theme({
  '&': {
    '--theme-dim': 'color-mix(in srgb, var(--theme-fg) 82%, var(--theme-bg))',
    color: 'var(--theme-fg)',
    backgroundColor: 'var(--theme-bg)',
  },
  '.cm-content': {
    color: 'var(--theme-fg)',
  },
  '.cm-gutters': {
    color: 'color-mix(in srgb, var(--theme-fg) 78%, var(--theme-bg))',
  },
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
    backgroundColor: 'color-mix(in srgb, var(--theme-error) 10%, var(--theme-bg))',
  },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'color-mix(in srgb, var(--theme-success) 10%, var(--theme-bg))',
  },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: 'color-mix(in srgb, var(--theme-error) 22%, var(--theme-bg))',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'color-mix(in srgb, var(--theme-success) 22%, var(--theme-bg))',
  },
  // Changed text must stay readable even when terminal syntax colors are dim on the diff tint.
  '.cm-changedText, .cm-changedText *, .cm-deletedText, .cm-deletedText *': {
    color: 'var(--theme-fg)',
    textDecoration: 'none',
  },
  '.cm-insertedLine, .cm-deletedLine': {
    color: 'inherit',
    textDecoration: 'none',
  },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    background: 'var(--theme-error)',
  },
  '&.cm-merge-b .cm-changedLineGutter': {
    background: 'var(--theme-success)',
  },
  '.cm-collapsedLines': {
    color: 'color-mix(in srgb, var(--theme-fg) 78%, var(--theme-bg))',
    background: 'color-mix(in srgb, var(--theme-accent) 5%, var(--theme-bg))',
    borderTop: '1px solid var(--theme-border)',
    borderBottom: '1px solid var(--theme-border)',
    fontSize: '11px',
    fontFamily: 'var(--theme-font-sans)',
    textAlign: 'center',
    padding: '4px 12px',
  },
  '.cm-collapsedLines:before': {
    content: '"↕"',
    marginInlineEnd: '8px',
  },
  '.cm-collapsedLines:after': {
    content: '" · click to expand"',
  },
  '.cm-collapsedLines:hover': {
    color: 'var(--theme-fg)',
    background: 'var(--theme-hover-bg)',
  },
})
