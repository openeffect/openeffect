import { createSelector } from 'reselect'
import type { AppState } from '../types'

// ─── Base selectors ──────────────────────────────────────────────────────────

export const selectEffects = (s: AppState) => s.effects.items
export const selectEffectsStatus = (s: AppState) => s.effects.status
export const selectEffectsError = (s: AppState) => s.effects.error
export const selectSelectedId = (s: AppState) => s.effects.selectedId
export const selectSearchQuery = (s: AppState) => s.effects.searchQuery
export const selectActiveSource = (s: AppState) => s.effects.activeSource
export const selectActiveType = (s: AppState) => s.effects.activeType
export const selectActiveCategory = (s: AppState) => s.effects.activeCategory
export const selectRightTab = (s: AppState) => s.effects.rightTab

// ─── Derived selectors ───────────────────────────────────────────────────────

export const selectSelectedEffect = createSelector(
  selectEffects,
  selectSelectedId,
  (effects, id) =>
    id ? (effects.find((e) => e.db_id === id) ?? null) : null,
)

export const selectFilteredEffects = createSelector(
  selectEffects,
  selectSearchQuery,
  selectActiveSource,
  selectActiveType,
  selectActiveCategory,
  (effects, query, source, type, category) => {
    return effects.filter((e) => {
      if (source === 'official' && e.source !== 'official') return false
      if (source === 'mine' && e.source !== 'local') return false
      if (source === 'installed' && (e.source === 'official' || e.source === 'local'))
        return false
      if (type !== 'all' && e.type !== type) return false
      if (category !== 'all' && e.category !== category) return false
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

// Categories available for the currently selected type
export const selectAvailableCategories = createSelector(
  selectEffects,
  selectActiveType,
  (effects, type) => {
    const filtered = type === 'all' ? effects : effects.filter((e) => e.type === type)
    return Array.from(new Set(filtered.map((e) => e.category)))
  },
)
