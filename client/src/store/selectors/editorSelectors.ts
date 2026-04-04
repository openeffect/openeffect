import { createSelector } from 'reselect'
import type { AppState } from '../types'
import { selectSelectedId } from './effectsSelectors'

// ─── Base selectors ──────────────────────────────────────────────────────────

export const selectEditorIsOpen = (s: AppState) => s.editor.isOpen
export const selectEditorYaml = (s: AppState) => s.editor.yamlContent
export const selectEditorLastSavedYaml = (s: AppState) => s.editor.lastSavedYaml
export const selectEditingEffectId = (s: AppState) => s.editor.editingEffectId
export const selectSavedManifest = (s: AppState) => s.editor.savedManifest
export const selectAssetFiles = (s: AppState) => s.editor.assetFiles
export const selectIsSaving = (s: AppState) => s.editor.isSaving
export const selectIsForking = (s: AppState) => s.editor.isForking
export const selectSaveError = (s: AppState) => s.editor.saveError
export const selectSaveVersion = (s: AppState) => s.editor.saveVersion

// ─── Derived selectors ───────────────────────────────────────────────────────

export const selectIsDirty = (s: AppState) =>
  s.editor.yamlContent !== s.editor.lastSavedYaml

// Cross-slice: right panel is open when an effect is selected OR editor is open
export const selectIsFormOpen = createSelector(
  selectSelectedId,
  selectEditorIsOpen,
  (selectedId, editorOpen) => selectedId !== null || editorOpen,
)
