import type React from 'react'
import { Database } from 'lucide-react'
import type { UseDialogReturn } from '../hooks/useDialog'
import SettingsBackupSection from './SettingsBackupSection'

export interface DataSettingsProps {
  showAlert?: UseDialogReturn['showAlert']
}

const CARD_CLS = 'rounded-xl bg-theme-sidebar/60 border border-theme-border/60 p-3.5 flex flex-col gap-3'
const SECTION_TITLE_CLS = 'flex items-center gap-1.5 text-xs font-bold text-theme-fg uppercase tracking-wider'

export const DataSettings: React.FC<DataSettingsProps> = ({ showAlert }) => {
  return (
    <div className="p-4 flex flex-col gap-3">
      <section className={CARD_CLS} aria-label="Backup & Restore">
        <div className={SECTION_TITLE_CLS}>
          <Database className="w-3.5 h-3.5 text-theme-accent" />
          <span>Data &amp; Backup</span>
        </div>
        <SettingsBackupSection showAlert={showAlert} />
      </section>
    </div>
  )
}

export default DataSettings
