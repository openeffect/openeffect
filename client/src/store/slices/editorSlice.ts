import type { EditorSlice } from '../types'

export const initialEditorState: EditorSlice = {
  yamlContent: '',
  lastSavedYaml: '',
  savedManifest: null,
  editingEffectId: null,
  assetFiles: [],
  isOpen: false,
  isSaving: false,
  isForking: false,
  saveError: null,
}
