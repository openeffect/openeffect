import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffectsStore, useFilteredEffects, useSelectedEffect } from '@/store/effectsStore'
import { GalleryFilters } from './GalleryFilters'
import { EffectCard } from './EffectCard'
import { EffectHero } from './EffectHero'
import { formatEffectType } from '@/lib/formatters'
import { Loader2, Sparkles } from 'lucide-react'

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
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
        <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading effects...</span>
      </div>
    )
  }

  const grouped =
    activeCategory === 'all' ? groupByType(filteredEffects) : { [activeCategory]: filteredEffects }

  return (
    <div className="flex h-full flex-col">
      {/* Fixed zone 1: Hero preview */}
      <AnimatePresence>
        {selectedEffect && (
          <motion.div
            key="hero-wrapper"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
            className="shrink-0 overflow-hidden"
          >
            <EffectHero effect={selectedEffect} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed zone 2: Search + filters */}
      <div className="shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <GalleryFilters />
      </div>

      {/* Scrollable zone: Effect grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-8 px-6 pb-8 pt-5">
          {Object.entries(grouped).map(([type, effects]) => (
            <div key={type}>
              {activeCategory === 'all' && (
                <h2
                  className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
                  {formatEffectType(type.replace(/-/g, '_'))}
                  <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
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
              <Sparkles size={32} style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No effects found</p>
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
    const type = e.effect_type.replace(/_/g, '-')
    if (!groups[type]) groups[type] = []
    groups[type].push(e)
  }
  return groups
}
