import BlurModal from '../../plugins/blur/app/BlurModal'

interface BlurSettingsOverlayProps {
  value: number
  onChange: (value: number) => void
  onClose: () => void
}

export default function BlurSettingsOverlay({ value, onChange, onClose }: BlurSettingsOverlayProps) {
  return <BlurModal value={value} onChange={onChange} onClose={onClose} />
}
