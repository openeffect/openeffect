import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '@/store'
import {
  selectEffectsStatus,
  selectActiveType,
  selectActiveSource,
  selectSearchQuery,
  selectFilteredEffects,
  selectSelectedEffect,
} from '@/store/selectors/effectsSelectors'
import { loadEffects, setActiveType } from '@/store/actions/effectsActions'
import { GalleryFilters } from './GalleryFilters'
import { EffectCard } from './EffectCard'
import { EffectHero } from './EffectHero'
import { formatEffectType } from '@/utils/formatters'
import { ArrowRight, Loader2, Sparkles, Star } from 'lucide-react'
import { Separator } from '@/components/ui/Separator'
import type { EffectManifest } from '@/types/api'

// Maximum effect cards shown per type on the front page (activeType === 'all')
// before truncating with a "View all" tile. 9 + the tile = 10 items, which is
// exactly 2 rows on lg (5 cols); narrower breakpoints overflow slightly but
// that's acceptable — narrow-screen users expect to scroll anyway.
const MAX_PER_TYPE_ON_HOME = 9

export function EffectGallery() {
  const status = useStore(selectEffectsStatus)
  const activeType = useStore(selectActiveType)
  const activeSource = useStore(selectActiveSource)
  const searchQuery = useStore(selectSearchQuery)
  const filteredEffects = useStore(selectFilteredEffects)
  const selectedEffect = useStore(selectSelectedEffect)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (status === 'idle') loadEffects()
  }, [status])

  // Reset scroll to top on any filter change — the user's previous scroll
  // position doesn't map to anything meaningful after the result set reshapes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [activeType, activeSource, searchQuery])

  if (status === 'loading') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 size={28} className="animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading effects...</span>
      </div>
    )
  }

  // Favorites also stay in their type section so favoriting feels like adding
  // a shortcut, not removing the card. Different React keys (fav- prefix vs id)
  // keep the duplicate render valid.
  const favorites = filteredEffects.filter((e) => e.is_favorite)

  const grouped =
    activeType === 'all' ? groupByType(filteredEffects) : { [activeType]: filteredEffects }

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="px-6 pb-8">
          {/* Favorites section — unlimited, rendered first */}
          {favorites.length > 0 && (
            <div>
              <h2 className="flex items-center gap-2 py-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <Separator className="flex-1" />
                <Star size={12} className="text-yellow-400" />
                Favorites
                <Separator className="flex-1" />
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {favorites.map((effect) => (
                  <EffectCard key={`fav-${effect.id}`} effect={effect} />
                ))}
              </div>
            </div>
          )}

          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([type, effects]) => {
            if (effects.length === 0) return null
            const shouldLimit = activeType === 'all' && effects.length > MAX_PER_TYPE_ON_HOME
            const visibleEffects = shouldLimit ? effects.slice(0, MAX_PER_TYPE_ON_HOME) : effects
            return (
              <div key={type}>
                <h2 className="flex items-center gap-2 py-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  <Separator className="flex-1" />
                  {formatEffectType(type)}
                  <Separator className="flex-1" />
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {visibleEffects.map((effect) => (
                    <EffectCard key={effect.id} effect={effect} />
                  ))}
                  {shouldLimit && (
                    <ViewAllTile
                      type={type}
                      hiddenCount={effects.length - MAX_PER_TYPE_ON_HOME}
                    />
                  )}
                </div>
              </div>
            )
          })}
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

/* ─── View-all tile: shown in the last grid slot when a type has more effects
 *     than MAX_PER_TYPE_ON_HOME. Matches EffectCard's outer dimensions via
 *     grid's default align-items:stretch, so it fills the same row height.
 */
function ViewAllTile({ type, hiddenCount }: { type: string; hiddenCount: number }) {
  return (
    <motion.div
      onClick={() => setActiveType(type)}
      whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
      className="group flex h-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-card/40 p-4 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
        <ArrowRight size={20} />
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">View all</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {hiddenCount} more
        </div>
      </div>
    </motion.div>
  )
}

function groupByType(effects: EffectManifest[]) {
  const groups: Record<string, EffectManifest[]> = {}
  for (const e of effects) {
    const t = e.type
    if (!groups[t]) groups[t] = []
    groups[t]!.push(e)
  }
  return groups
}
