import { motion } from 'framer-motion'
import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'
import { useEffectsStore } from '@/store/effectsStore'
import { formatEffectType } from '@/lib/formatters'

interface EffectCardProps {
  effect: EffectManifest
}

export function EffectCard({ effect }: EffectCardProps) {
  const selectEffect = useEffectsStore((s) => s.selectEffect)
  const selectedId = useEffectsStore((s) => s.selectedEffectId)

  const fullId = `${effect.type}/${effect.id}`
  const isSelected = selectedId === fullId
  const firstInputFile = effect.assets.inputs ? Object.values(effect.assets.inputs).find((v) => v.endsWith('.jpg') || v.endsWith('.jpeg') || v.endsWith('.png') || v.endsWith('.webp')) : null
  const posterUrl = firstInputFile ? api.getAssetUrl(fullId, firstInputFile) : null
  const previewUrl = effect.assets.preview ? api.getAssetUrl(fullId, effect.assets.preview) : null

  return (
    <motion.div
      onClick={() => selectEffect(fullId)}
      className="group cursor-pointer overflow-hidden rounded-xl transition-shadow"
      style={{
        background: 'var(--surface)',
        border: isSelected ? '2px solid var(--accent)' : '2px solid var(--border)',
        boxShadow: isSelected ? '0 0 0 1px var(--accent), var(--shadow-sm)' : 'var(--shadow-sm)',
      }}
      whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
    >
      <div className="relative aspect-[3/4] overflow-hidden">
        {/* Static poster as fallback */}
        {posterUrl && (
          <img
            src={posterUrl}
            alt={effect.name}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        )}
        {/* Preview video plays on top */}
        {previewUrl && (
          <video
            src={previewUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {/* Gradient overlay at bottom */}
        <div
          className="absolute inset-x-0 bottom-0 h-1/3"
          style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}
        />
        {/* Category badge */}
        <span
          className="absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/90"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
        >
          {formatEffectType(effect.type)}
        </span>
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {effect.name}
        </h3>
        <p
          className="mt-1 line-clamp-2 text-xs leading-relaxed"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {effect.description}
        </p>
        {effect.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {effect.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{ background: 'var(--surface-elevated)', color: 'var(--text-tertiary)' }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
