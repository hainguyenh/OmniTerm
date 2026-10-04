import { LockKeyhole } from 'lucide-react'

import type { TextEol } from '../../utils/textFileWire'
import type { FileProfile } from './fileProfile'
import { languageLabel, type LanguageId } from './languageLoader'
import type { CursorInfo } from './useTextDocument'

interface FileEditorStatusBarProps {
  cursor: CursorInfo
  languageId: LanguageId
  profile: FileProfile
  eol: TextEol
  mixedEol: boolean
  bom: boolean
  editable: boolean
  onEolChange: (eol: TextEol) => void
  onBomChange: (bom: boolean) => void
}

/** Cursor position plus the file's format, the way VS Code's status bar shows them. Line ending and
 *  BOM are toggles: changing either marks the file dirty and takes effect on the next save. */
export function FileEditorStatusBar({
  cursor, languageId, profile, eol, mixedEol, bom, editable, onEolChange, onBomChange,
}: FileEditorStatusBarProps) {
  const position = cursor.selections > 1
    ? `${cursor.selections} selections`
    : `Ln ${cursor.line}, Col ${cursor.col}${cursor.selected ? ` (${cursor.selected} selected)` : ''}`
  return (
    <div className="file-editor-status">
      {!editable && <span className="file-editor-access"><LockKeyhole />Read only</span>}
      <span className="file-editor-position">{position}</span>
      <span className="file-editor-language">{profile === 'full' ? languageLabel(languageId) : `${languageLabel(languageId)} (plain)`}</span>
      <button
        type="button"
        disabled={!editable}
        title={mixedEol ? 'Mixed line endings — saving will use this one throughout' : 'Line ending used when saving'}
        onClick={() => onEolChange(eol === 'crlf' ? 'lf' : 'crlf')}
      >
        {mixedEol ? `Mixed → ${eol.toUpperCase()}` : eol.toUpperCase()}
      </button>
      <button
        type="button"
        disabled={!editable}
        title="Byte order mark written when saving"
        onClick={() => onBomChange(!bom)}
      >
        {bom ? 'UTF-8 with BOM' : 'UTF-8'}
      </button>
    </div>
  )
}
