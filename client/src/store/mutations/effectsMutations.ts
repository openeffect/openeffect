import type { AppState, RightTab } from '../types'

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
