import { fileAppearance } from '../utils/fileAppearance'
import './file-type-icon.css'

export function FileTypeIcon({ name, kind, ignored = false }: { name: string; kind: string; ignored?: boolean }) {
  const meta = fileAppearance(name, kind)
  const Icon = meta.icon
  const mark = meta.label === 'TypeScript' ? 'TS' : meta.label === 'JavaScript' ? 'JS' : null
  return (
    <span className={`file-type-icon ${ignored ? 'is-ignored' : ''}`} style={{ color: `color-mix(in srgb, ${meta.color} 85%, var(--theme-fg))` }} title={ignored ? `${meta.label} · Git ignored` : meta.label}>
      {mark ? <span className="file-type-mark" aria-hidden="true">{mark}</span> : <Icon aria-hidden="true" />}
    </span>
  )
}
