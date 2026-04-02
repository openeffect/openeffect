import { createSelector } from 'reselect'
import type { AppState } from '../types'

// ─── Base selectors ──────────────────────────────────────────────────────────

export const selectEffects = (s: AppState) => s.effects.items
export const selectEffectsStatus = (s: AppState) => s.effects.status
export const selectEffectsError = (s: AppState) => s.effects.error
export const selectSelectedId = (s: AppState) => s.effects.selectedId
export const selectSearchQuery = (s: AppState) => s.effects.searchQuery
export const selectActiveSource = (s: AppState) => s.effects.activeSource
export const selectActiveCategory = (s: AppState) => s.effects.activeCategory

// ─── Derived selectors ───────────────────────────────────────────────────────

export const selectSelectedEffect = createSelector(
  selectEffects,
  selectSelectedId,
  (effects, id) =>
    id ? (effects.find((e) => `${e.namespace}/${e.id}` === id) ?? null) : null,
)

export const selectFilteredEffects = createSelector(
  selectEffects,
  selectSearchQuery,
  selectActiveSource,
  selectActiveCategory,
  (effects, query, source, category) => {
    return effects.filter((e) => {
      if (source === 'official' && e.source !== 'official') return false
      if (source === 'mine' && e.source !== 'local') return false
      if (source === 'installed' && (e.source === 'official' || e.source === 'local'))
        return false
      if (category !== 'all') {
        if (e.type !== category && e.category !== category) {
          return false
        }
      }
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
