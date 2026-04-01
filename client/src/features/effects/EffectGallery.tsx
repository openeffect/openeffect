import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffectsStore, useFilteredEffects, useSelectedEffect } from '@/store/effectsStore'
import { GalleryFilters } from './GalleryFilters'
import { EffectCard } from './EffectCard'
import { EffectHero } from './EffectHero'
import { formatEffectType } from '@/lib/formatters'
import { Loader2, Sparkles } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export function EffectGallery() {
  const loadEffects = useEffectsStore((s) => s.loadEffects)
  const status = useEffectsStore((s) => s.status)
  const activeCategory = useEffectsStore((s) => s.activeCategory)
  const filteredEffects = useFilteredEffects()
  const selectedEffect = useSelectedEffect()

  useEffect(() => {
    if (status === 'idle') loadEffects()
  }, [status, loadEffects])

  if (status === 'loading') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 size={28} className="animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading effects...</span>
      </div>
    )
  }

  const grouped =
    activeCategory === 'all' ? groupByType(filteredEffects) : { [activeCategory]: filteredEffects }

  const showHero = selectedEffect && !!(
    selectedEffect.assets.preview ||
    (selectedEffect.assets.inputs && Object.keys(selectedEffect.assets.inputs).length > 0)
  )

  return (
    <div className="flex h-full flex-col">
      {/* Fixed zone 1: Hero preview */}
      <AnimatePresence>
        {showHero && (
          <motion.div
            key="hero-wrapper"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
            className="shrink-0 overflow-hidden"
          >
            <EffectHero effect={selectedEffect!} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed zone 2: Search + filters */}
      <div className="shrink-0">
        <GalleryFilters />
      </div>

      {/* Scrollable zone: Effect grid */}
      <div className="flex-1 overflow-y-auto">
        <div className={cn('px-6 pb-8', activeCategory !== 'all' && 'pt-4')}>
          {Object.entries(grouped).map(([type, effects]) => (
            <div key={type}>
              {activeCategory === 'all' && (
                <h2 className="flex items-center gap-2 py-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  <Separator className="flex-1" />
                  {formatEffectType(type)}
                  <Separator className="flex-1" />
                </h2>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {effects.map((effect) => (
                  <EffectCard key={effect.id} effect={effect} />
                ))}
              </div>
            </div>
          ))}
          {filteredEffects.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <Sparkles size={32} className="text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">No effects found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function groupByType(effects: ReturnType<typeof useFilteredEffects>) {
  const groups: Record<string, typeof effects> = {}
  for (const e of effects) {
    const t = e.type
    if (!groups[t]) groups[t] = []
    groups[t]!.push(e)
  }
  return groups
}
