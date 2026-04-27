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
  isEditing: false,
  saveError: null,
  saveVersion: 0,
}
