import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import type { EffectManifest } from '@/types/api'
import { useStore } from '@/store'
import { selectSelectedId } from '@/store/selectors/effectsSelectors'
import { selectEffect } from '@/store/actions/effectsActions'
import { formatEffectType, isVideoUrl } from '@/utils/formatters'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/utils/cn'

interface EffectCardProps {
  effect: EffectManifest
}

export function EffectCard({ effect }: EffectCardProps) {
  const selectedId = useStore(selectSelectedId)

  const isSelected = selectedId === effect.db_id
  // Assets are pre-resolved URLs from the server
  const firstInputUrl = effect.assets.inputs ? Object.values(effect.assets.inputs).find((v) => v.includes('.jpg') || v.includes('.jpeg') || v.includes('.png') || v.includes('.webp')) : null
  const posterUrl = firstInputUrl ?? null
  const previewUrl = effect.assets.preview ?? null

  return (
    <motion.div
      onClick={() => selectEffect(effect.db_id)}
      className={cn(
        'group cursor-pointer overflow-hidden rounded-xl border-2 bg-card shadow-sm transition-shadow',
        isSelected
          ? 'border-primary ring-1 ring-primary'
          : 'border-border',
      )}
      whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-muted">
        {/* Placeholder — always rendered behind, visible when no assets or assets fail to load */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles size={28} className="text-muted-foreground opacity-30" />
        </div>
        {/* Static poster as fallback */}
        {posterUrl && (
          <img
            src={posterUrl}
            alt={effect.name}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        {/* Preview (video or image) plays on top */}
        {previewUrl && (isVideoUrl(previewUrl) ? (
          <video
            src={previewUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <img
            src={previewUrl}
            alt={effect.name}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ))}
        {/* Gradient overlay at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
        {/* Category badge */}
        <Badge variant="overlay" className="absolute left-2 top-2 uppercase tracking-wide">
          {formatEffectType(effect.type)}
        </Badge>
        {/* Author badge for installed effects */}
        {effect.source !== 'official' && (
          <span className="absolute right-2 top-2 inline-flex items-center rounded-full bg-primary/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
            {effect.namespace}
          </span>
        )}
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
