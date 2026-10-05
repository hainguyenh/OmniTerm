import { EditorView } from '@codemirror/view'

/**
 * Merge-view colors written against the app's `--theme-*` variables, replacing @codemirror/merge's
 * fixed light/dark palette so the diff follows every theme the way the editor itself does.
 */
export const diffTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
    backgroundColor: 'color-mix(in srgb, var(--theme-error) 14%, transparent)',
  },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'color-mix(in srgb, var(--theme-success) 14%, transparent)',
  },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: 'color-mix(in srgb, var(--theme-error) 32%, transparent)',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'color-mix(in srgb, var(--theme-success) 32%, transparent)',
  },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    background: 'var(--theme-error)',
  },
  '&.cm-merge-b .cm-changedLineGutter': {
    background: 'var(--theme-success)',
  },
  '.cm-collapsedLines': {
    color: 'var(--theme-accent)',
    background: 'color-mix(in srgb, var(--theme-accent) 7%, var(--theme-bg))',
    borderTop: '1px solid var(--theme-border)',
    borderBottom: '1px solid var(--theme-border)',
    fontSize: '12px',
    fontFamily: 'var(--theme-font-sans)',
    textAlign: 'center',
    padding: '7px 12px',
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
