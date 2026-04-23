import { setState, getState } from '../index'
import { mutateCloseEditor } from '../mutations/editorMutations'
import { mutateSelectEffect } from '../mutations/effectsMutations'
import { mutateClearViewingJob } from '../mutations/runMutations'
import { api } from '@/utils/api'
import { navigate, replaceRoute } from '@/utils/router'
import { manifestToYaml } from '@/utils/yaml'
import { playgroundRunToManifest } from '@/utils/playgroundSeed'
import type { EffectManifest, RunRecord } from '@/types/api'
import type { AssetFile } from '../types'
import { selectEffect } from './effectsActions'

// ─── Constants ───────────────────────────────────────────────────────────────

const BLANK_TEMPLATE = `namespace: my
id: new-effect
name: New Effect
description: >
  Describe what this effect does.
version: "1.0.0"
author: me
type: transform
tags:
  - custom

assets:
  preview: preview.mp4
  inputs:
    image: input-image.jpg

inputs:
  image:
    type: image
    role: start_frame
    required: true
    label: "Your photo"
    hint: "Upload a photo to use"

  prompt:
    type: text
    role: prompt_input
    required: false
    label: "Describe the scene"
    placeholder: "A cinematic shot..."
    max_length: 500
    multiline: false

generation:
  models:
    - kling-3.0
    - wan-2.7
  default_model: kling-3.0

  prompt: >
    Cinematic effect on the subject. {prompt}
    High quality, 4K resolution.

  negative_prompt: >
    low quality, blurry, watermark

  params:
    duration: 5
    guidance_scale: 8.0
`

const BLANK_MANIFEST: EffectManifest = {
  db_id: '',
  compatible_models: [],
  is_favorite: false,
  namespace: 'my',
  id: 'new-effect',
  name: 'New Effect',
  description: 'Describe what this effect does.',
  version: '1.0.0',
  author: 'me',
  type: 'transform',
  tags: ['custom'],
  assets: {},
  inputs: {
    image: {
      type: 'image',
      role: 'start_frame',
      required: true,
      label: 'Your photo',
      hint: 'Upload a photo to use',
    },
    prompt: {
      type: 'text',
      role: 'prompt_input',
      required: false,
      label: 'Describe the scene',
      placeholder: 'A cinematic shot...',
      max_length: 500,
      multiline: false,
    },
  },
  generation: {
    prompt: 'Cinematic effect on the subject. {prompt} High quality, 4K resolution.',
    negative_prompt: 'low quality, blurry, watermark',
    models: ['kling-3.0', 'wan-2.7'],
    default_model: 'kling-3.0',
    params: { duration: { default: 5 }, guidance_scale: { default: 8.0 } },
    model_overrides: {},
    reverse: false,
  },
  source: 'local',
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export function openEditor(
  yaml: string,
  effectId: string,
  manifest?: EffectManifest,
  files?: AssetFile[],
): void {
  setState((s) => {
    mutateClearViewingJob(s)
    s.playground.isOpen = false
    s.effects.rightTab = 'form'
    s.editor.yamlContent = yaml
    s.editor.lastSavedYaml = yaml
    s.editor.savedManifest = manifest ?? null
    s.editor.editingEffectId = effectId
    s.editor.assetFiles = files ?? []
    s.editor.isOpen = true
    s.editor.saveError = null
  }, 'editor/open')
  navigate(`/effects/${effectId}/edit`)
}

export function openBlankEditor(skipNav?: boolean): void {
  setState((s) => {
    mutateClearViewingJob(s)
    mutateSelectEffect(s, null)
    s.playground.isOpen = false
    s.effects.rightTab = 'form'
    s.editor.yamlContent = BLANK_TEMPLATE
    s.editor.lastSavedYaml = BLANK_TEMPLATE
    s.editor.savedManifest = BLANK_MANIFEST
    s.editor.editingEffectId = null
    s.editor.isOpen = true
    s.editor.saveError = null
  }, 'editor/openBlank')
  if (!skipNav) {
    navigate('/effects/new')
  }
}

/**
 * Open the editor with a new (unsaved) effect seeded from a successful
 * playground run. The run's prompt, image roles, model, and param defaults
 * become the manifest; the user can tweak and save.
 */
export function createEffectFromRun(record: RunRecord): void {
  const manifest = playgroundRunToManifest(record)
  const yaml = manifestToYaml(manifest as unknown as Record<string, unknown>)
  setState((s) => {
    mutateClearViewingJob(s)
    mutateSelectEffect(s, null)
    s.playground.isOpen = false
    s.effects.rightTab = 'form'
    s.editor.yamlContent = yaml
    s.editor.lastSavedYaml = yaml
    s.editor.savedManifest = manifest
    s.editor.editingEffectId = null
    s.editor.isOpen = true
    s.editor.saveError = null
  }, 'editor/createFromRun')
  navigate('/effects/new')
}

export function closeEditor(): void {
  setState((s) => {
    mutateCloseEditor(s)
  }, 'editor/close')
}

/** Returns true if safe to close (no unsaved changes or user confirmed discard). */
export function confirmClose(): boolean {
  const s = getState()
  if (s.editor.yamlContent === s.editor.lastSavedYaml) return true
  return window.confirm('You have unsaved changes. Discard them?')
}

export function updateYaml(content: string): void {
  setState((s) => {
    s.editor.yamlContent = content
    s.editor.saveError = null
  }, 'editor/updateYaml')
}

export async function saveEffect(): Promise<void> {
  const { yamlContent, editingEffectId } = getState().editor
  setState((s) => {
    s.editor.isSaving = true
    s.editor.saveError = null
  }, 'editor/saveStart')

  try {
    const result = await api.saveEffect(yamlContent, editingEffectId)
    const dbId = result.manifest.db_id ?? result.effect_id

    const currentYaml = getState().editor.yamlContent
    setState((s) => {
      // Upsert the saved manifest. New effects go to the front (matches the
      // server's newest-first order); re-saves keep their current position.
      if (s.effects.items.has(dbId)) {
        s.effects.items.set(dbId, result.manifest)
      } else {
        s.effects.items = new Map([[dbId, result.manifest], ...s.effects.items])
      }
      s.editor.editingEffectId = dbId
      s.editor.savedManifest = result.manifest
      s.editor.lastSavedYaml = currentYaml
      s.editor.isSaving = false
      s.editor.saveVersion++
    }, 'editor/save')

    replaceRoute(`/effects/${dbId}/edit`)
    selectEffect(dbId, true)
  } catch (e) {
    setState((s) => {
      s.editor.isSaving = false
      s.editor.saveError = e instanceof Error ? e.message : 'Save failed'
    }, 'editor/saveFailed')
  }
}

export async function forkEffect(effect: EffectManifest): Promise<void> {
  setState((s) => {
    s.editor.isForking = true
    s.editor.saveError = null
  }, 'editor/forkStart')

  try {
    const { yaml: originalYaml } = await api.getEffectEditorData(effect.namespace, effect.id)

    const forkId = `${effect.id}-copy`
    const yamlContent = originalYaml
      .replace(/^namespace:\s*.+$/m, 'namespace: my')
      .replace(/^id:\s*.+$/m, `id: ${forkId}`)
      .replace(/^name:\s*.+$/m, `name: ${effect.name} (Copy)`)

    const sourceId = `${effect.namespace}/${effect.id}`
    const result = await api.saveEffect(yamlContent, null, sourceId)
    const dbId = result.manifest.db_id ?? result.effect_id

    const { yaml: savedYaml, files } = await api.getEffectEditorData(
      result.manifest.namespace,
      result.manifest.id,
    )

    setState((s) => {
      // Insert the new fork at the front so it appears at the top of the
      // gallery — matches the server's newest-first order.
      s.effects.items = new Map([[dbId, result.manifest], ...s.effects.items])
      mutateClearViewingJob(s)
      s.editor.yamlContent = savedYaml
      s.editor.lastSavedYaml = savedYaml
      s.editor.savedManifest = result.manifest
      s.editor.editingEffectId = dbId
      s.editor.assetFiles = files
      s.editor.isOpen = true
      s.editor.isForking = false
      s.editor.saveVersion++
      mutateSelectEffect(s, dbId)
    }, 'editor/fork')

    replaceRoute(`/effects/${dbId}/edit`)
  } catch (e) {
    setState((s) => {
      s.editor.isForking = false
      s.editor.saveError = e instanceof Error ? e.message : 'Duplicate failed'
    }, 'editor/forkFailed')
  }
}

/** Fork from a stored manifest (e.g., from a run record when the effect is deleted). */
export async function forkFromManifest(manifest: EffectManifest): Promise<void> {
  setState((s) => {
    s.editor.isForking = true
    s.editor.saveError = null
  }, 'editor/forkFromManifestStart')

  try {
    const forkId = `${manifest.id}-copy`
    const forkData = {
      ...manifest,
      namespace: 'my',
      id: forkId,
      name: `${manifest.name} (Copy)`,
      assets: {},
    }
    const yamlContent = manifestToYaml(forkData as unknown as Record<string, unknown>)

    const result = await api.saveEffect(yamlContent, null)
    const dbId = result.manifest.db_id ?? result.effect_id

    const { yaml: savedYaml, files } = await api.getEffectEditorData(
      result.manifest.namespace,
      result.manifest.id,
    )

    setState((s) => {
      // Insert the new fork at the front so it appears at the top of the
      // gallery — matches the server's newest-first order.
      s.effects.items = new Map([[dbId, result.manifest], ...s.effects.items])
      mutateClearViewingJob(s)
      s.editor.yamlContent = savedYaml
      s.editor.lastSavedYaml = savedYaml
      s.editor.savedManifest = result.manifest
      s.editor.editingEffectId = dbId
      s.editor.assetFiles = files
      s.editor.isOpen = true
      s.editor.isForking = false
      s.editor.saveVersion++
      mutateSelectEffect(s, dbId)
    }, 'editor/forkFromManifest')

    replaceRoute(`/effects/${dbId}/edit`)
  } catch (e) {
    setState((s) => {
      s.editor.isForking = false
      s.editor.saveError = e instanceof Error ? e.message : 'Duplicate failed'
    }, 'editor/forkFromManifestFailed')
  }
}

export async function editEffect(effect: EffectManifest): Promise<void> {
  try {
    const { yaml, files } = await api.getEffectEditorData(effect.namespace, effect.id)
    openEditor(yaml, effect.db_id, effect, files)
  } catch {
    forkEffect(effect)
  }
}
