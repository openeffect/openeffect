import { motion } from 'framer-motion'
import { Sparkles, Star } from 'lucide-react'
import type { EffectManifest, FileRef } from '@/types/api'
import { useStore } from '@/store'
import { selectSelectedId } from '@/store/selectors/effectsSelectors'
import { selectEffect, toggleFavorite } from '@/store/actions/effectsActions'
import { formatEffectCategory } from '@/utils/formatters'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/utils/cn'

interface EffectCardProps {
  effect: EffectManifest
}

function isFileRef(v: unknown): v is FileRef {
  return typeof v === 'object' && v !== null && 'kind' in v && 'url' in v
}

export function EffectCard({ effect }: EffectCardProps) {
  const selectedId = useStore(selectSelectedId)

  const isSelected = selectedId === effect.id
  // Showcase entries are pre-resolved FileRefs (or null when the asset
  // isn't ingested yet). The card shows the first showcase; the detail
  // page has a picker for the rest.
  const first = effect.showcases[0]
  // Static poster: the first image-typed input ref, used as a fallback
  // behind the preview video while it loads (or when the preview is
  // itself just an image).
  const posterRef = first?.inputs
    ? Object.values(first.inputs).find(isFileRef) ?? null
    : null
  const previewRef = first?.preview ?? null
  // Cards are small (~200-400px). The 512.webp tier is plenty.
  const posterUrl = posterRef?.thumbnails['512'] ?? posterRef?.url ?? null
  const isVideoPreview = previewRef?.kind === 'video'
  const previewUrl = isVideoPreview
    ? previewRef.url
    : (previewRef?.thumbnails['512'] ?? previewRef?.url ?? null)

  return (
    <motion.div
      onClick={() => selectEffect(effect.id)}
      className={cn(
        'group cursor-pointer overflow-hidden rounded-xl border-2 bg-card shadow-sm transition-shadow',
        isSelected
          ? 'border-primary ring-1 ring-primary'
          : 'border-border',
      )}
      whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
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
        {previewUrl && (isVideoPreview ? (
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
        {/* Gradient overlay at bottom. The negative `bottom` + matching extra
            height push the gradient's anti-aliased bottom edge below the
            container so the parent's overflow-hidden clips it — without this,
            the hover scale(1.03) makes the fading edge visible as a thin
            bright strip at the bottom of the video. 4px (vs. 1px) absorbs
            the wider anti-aliased band browsers produce at the intermediate
            scales during the hover transition. */}
        <div className="absolute inset-x-0 -bottom-1 h-[calc(33.333%+0.25rem)] bg-gradient-to-t from-black/60 to-transparent" />
        {/* Category badge */}
        <Badge variant="overlay" className="absolute left-2 top-2 uppercase tracking-wide">
          {formatEffectCategory(effect.category)}
        </Badge>
        {/* Source badge: namespace for installed third-party effects,
            a plain "LOCAL" tag for user-owned ones. Official effects
            are unbadged — they're the expected default. */}
        {effect.source === 'installed' && (
          <span className="absolute right-2 top-2 inline-flex items-center rounded-full bg-primary/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
            {effect.namespace}
          </span>
        )}
        {effect.source === 'local' && (
          <span className="absolute right-2 top-2 inline-flex items-center rounded-full bg-primary/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
            Local
          </span>
        )}
        {/* Favorite star */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(effect) }}
          className={cn(
            'absolute bottom-2 right-2 rounded-full p-1 transition-all',
            effect.is_favorite
              ? 'text-yellow-400 hover:text-yellow-300'
              : 'text-white/50 opacity-0 group-hover:opacity-100 hover:text-white',
          )}
        >
          <Star size={16} fill={effect.is_favorite ? 'currentColor' : 'none'} />
        </button>
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
