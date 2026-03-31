import { motion } from 'framer-motion'
import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'
import { useEffectsStore } from '@/store/effectsStore'
import { formatEffectType } from '@/lib/formatters'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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
      className={cn(
        'group cursor-pointer overflow-hidden rounded-xl border-2 bg-card shadow-sm transition-shadow',
        isSelected
          ? 'border-primary ring-1 ring-primary'
          : 'border-border',
      )}
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
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
        {/* Category badge */}
        <Badge variant="overlay" className="absolute left-2 top-2 uppercase tracking-wide">
          {formatEffectType(effect.type)}
        </Badge>
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold leading-tight text-foreground">
          {effect.name}
        </h3>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {effect.description}
        </p>
        {effect.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {effect.tags.slice(0, 3).map((tag) => (
              <Badge key={tag}>
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
