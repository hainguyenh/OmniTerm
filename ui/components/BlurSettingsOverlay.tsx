import BlurModal from '../../plugins/blur/app/BlurModal'

interface BlurSettingsOverlayProps {
  strength: number
  blurDock: boolean
  enabled: boolean
  onSave: (strength: number, blurDock: boolean, enabled: boolean) => void
  onClose: () => void
}

export default function BlurSettingsOverlay({ strength, blurDock, enabled, onSave, onClose }: BlurSettingsOverlayProps) {
  return <BlurModal strength={strength} blurDock={blurDock} enabled={enabled} onSave={onSave} onClose={onClose} />
}
