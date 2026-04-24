import type { AppState, EffectSource, RightTab } from '../types'

/** Shared: used by historyActions, editorActions, effectsActions, appActions */
export function mutateSelectEffect(s: AppState, id: string | null) {
  if (id !== null && s.effects.selectedId === null) {
    // Opening an effect after none was selected — reset to form tab
    s.effects.rightTab = 'form'
  }
  s.effects.selectedId = id
}

/** Shared: used by EffectPanel, RunView */
export function mutateSetRightTab(s: AppState, tab: RightTab) {
  s.effects.rightTab = tab
}

/** Shared: applied by the route listener on every gallery/effect/edit/playground
 *  navigation so the store mirrors the URL's filter + search context. */
export function mutateSetFilters(
  s: AppState,
  filters: { category: string; source: EffectSource; search: string },
) {
  s.effects.activeCategory = filters.category
  s.effects.activeSource = filters.source
  s.effects.searchQuery = filters.search
}
