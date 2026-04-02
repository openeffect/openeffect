import type { AppState, AssetFile } from '../types'
import type { EffectManifest } from '@/types/api'

export function mutateOpenEditor(
  s: AppState,
  yaml: string,
  effectId: string,
  manifest?: EffectManifest,
  files?: AssetFile[],
) {
  s.editor.yamlContent = yaml
  s.editor.lastSavedYaml = yaml
  s.editor.savedManifest = manifest ?? null
  s.editor.editingEffectId = effectId
  s.editor.assetFiles = files ?? []
  s.editor.isOpen = true
  s.editor.saveError = null
}

export function mutateOpenBlankEditor(s: AppState, yaml: string, manifest: EffectManifest) {
  s.editor.yamlContent = yaml
  s.editor.lastSavedYaml = yaml
  s.editor.savedManifest = manifest
  s.editor.editingEffectId = null
  s.editor.isOpen = true
  s.editor.saveError = null
}

export function mutateCloseEditor(s: AppState) {
  s.editor.isOpen = false
  s.editor.editingEffectId = null
  s.editor.savedManifest = null
  s.editor.assetFiles = []
  s.editor.saveError = null
  s.editor.lastSavedYaml = ''
}

export function mutateUpdateYaml(s: AppState, content: string) {
  s.editor.yamlContent = content
  s.editor.saveError = null
}

export function mutateSaveStart(s: AppState) {
  s.editor.isSaving = true
  s.editor.saveError = null
}

export function mutateSaveSuccess(
  s: AppState,
  effectId: string,
  manifest: EffectManifest,
  currentYaml: string,
) {
  s.editor.editingEffectId = effectId
  s.editor.savedManifest = manifest
  s.editor.lastSavedYaml = currentYaml
  s.editor.isSaving = false
}

export function mutateSaveError(s: AppState, error: string) {
  s.editor.isSaving = false
  s.editor.saveError = error
}

export function mutateForkStart(s: AppState) {
  s.editor.isForking = true
  s.editor.saveError = null
}

export function mutateForkSuccess(
  s: AppState,
  yaml: string,
  manifest: EffectManifest,
  effectId: string,
  files: AssetFile[],
) {
  s.editor.yamlContent = yaml
  s.editor.lastSavedYaml = yaml
  s.editor.savedManifest = manifest
  s.editor.editingEffectId = effectId
  s.editor.assetFiles = files
  s.editor.isOpen = true
  s.editor.isForking = false
}

export function mutateForkError(s: AppState, error: string) {
  s.editor.isForking = false
  s.editor.saveError = error
}
