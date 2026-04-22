import { createSelector } from 'reselect'
import type { AppState } from '../types'

// ─── Base selectors ──────────────────────────────────────────────────────────

/** Underlying Map<db_id, EffectManifest>. Use `selectEffects` (the memoized
 *  array view) in components; this is the internal handle for keyed lookup. */
const selectEffectsMap = (s: AppState) => s.effects.items

export const selectEffects = createSelector(
  selectEffectsMap,
  (map) => Array.from(map.values()),
)

export const selectEffectsStatus = (s: AppState) => s.effects.status
export const selectEffectsError = (s: AppState) => s.effects.error
export const selectSelectedId = (s: AppState) => s.effects.selectedId
export const selectSearchQuery = (s: AppState) => s.effects.searchQuery
export const selectActiveSource = (s: AppState) => s.effects.activeSource
export const selectActiveType = (s: AppState) => s.effects.activeType
export const selectRightTab = (s: AppState) => s.effects.rightTab

// ─── Derived selectors ───────────────────────────────────────────────────────

export const selectSelectedEffect = createSelector(
  selectEffectsMap,
  selectSelectedId,
  (map, id) => (id ? map.get(id) ?? null : null),
)

export const selectFilteredEffects = createSelector(
  selectEffects,
  selectSearchQuery,
  selectActiveSource,
  selectActiveType,
  (effects, query, source, type) => {
    return effects.filter((e) => {
      if (source === 'official' && e.source !== 'official') return false
      if (source === 'mine' && e.source !== 'local') return false
      if (source === 'installed' && (e.source === 'official' || e.source === 'local'))
        return false
      if (type !== 'all' && e.type !== type) return false
      if (query) {
        const q = query.toLowerCase()
        return (
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
        )
      }
      return true
    })
  },
)
