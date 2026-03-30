import { MousePointerClick } from 'lucide-react'

export function EffectPanelEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <MousePointerClick size={40} style={{ color: 'var(--text-tertiary)' }} />
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Select an effect from the gallery to get started
      </p>
    </div>
  )
}
