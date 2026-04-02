import type { AppState, EffectSource } from '../types'
import type { EffectManifest } from '@/types/api'

export function mutateSetEffects(s: AppState, effects: EffectManifest[]) {
  s.effects.items = effects
}

export function mutateSetEffectsStatus(
  s: AppState,
  status: AppState['effects']['status'],
  error?: string | null,
) {
  s.effects.status = status
  if (error !== undefined) s.effects.error = error
}

export function mutateSelectEffect(s: AppState, id: string | null) {
  s.effects.selectedId = id
}

export function mutateSetSearchQuery(s: AppState, query: string) {
  s.effects.searchQuery = query
}

export function mutateSetActiveSource(s: AppState, source: EffectSource) {
  s.effects.activeSource = source
}

export function mutateSetActiveCategory(s: AppState, category: string) {
  s.effects.activeCategory = category
}
