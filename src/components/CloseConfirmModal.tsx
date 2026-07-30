import React, { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface CloseConfirmModalProps {
  onConfirm: (applyToAll: boolean) => void
  onCancel: () => void
  isMultiple: boolean
}

const CloseConfirmModal: React.FC<CloseConfirmModalProps> = ({
  onConfirm,
  onCancel,
  isMultiple,
}) => {
  const [applyToAll, setApplyToAll] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70]"
      onClick={handleBackdrop}
    >
      <div className="bg-theme-popup w-full max-w-sm rounded-2xl border border-theme-border shadow-2xl overflow-hidden">
        <div className="p-5 space-y-3">
          <h3 className="text-white font-bold flex items-center gap-2 text-lg">
            <AlertTriangle className="w-5 h-5 text-theme-warning" />
            Close Terminal
          </h3>
          <p className="text-sm text-theme-fg leading-relaxed">
            {isMultiple 
              ? "You are about to close multiple connected terminal sessions. This will terminate any active processes running inside them. Are you sure?"
              : "This terminal session is currently connected. Closing it will terminate any active processes running inside. Are you sure you want to close it?"}
          </p>
          
          <label className="flex items-center gap-2 cursor-pointer mt-2 text-sm text-theme-fg group">
            <input 
              type="checkbox" 
              checked={applyToAll} 
              onChange={(e) => setApplyToAll(e.target.checked)} 
              className="w-4 h-4 rounded border-theme-border bg-theme-bg accent-theme-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span className="group-hover:text-white transition-colors">Apply to all (Don't ask again)</span>
          </label>
        </div>
        
        <div className="flex gap-2 p-4 pt-0">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl border border-theme-border text-theme-fg hover:border-theme-accent hover:text-white transition-colors text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(applyToAll)}
            className="flex-1 py-2 rounded-xl bg-theme-error hover:bg-[#ff8da3] text-theme-accent-fg transition-colors text-sm font-bold"
          >
            Close Anyway
          </button>
        </div>
      </div>
    </div>
  )
}

export default CloseConfirmModal
