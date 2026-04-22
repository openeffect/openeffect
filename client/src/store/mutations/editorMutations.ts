import type { AppState } from '../types'

/** Shared: used by editorActions, effectsActions, appActions */
export function mutateCloseEditor(s: AppState) {
  s.editor.isOpen = false
  s.editor.editingEffectId = null
  s.editor.savedManifest = null
  s.editor.assetFiles = []
  s.editor.saveError = null
  s.editor.lastSavedYaml = ''
}
