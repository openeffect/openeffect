import { setState, getState } from '../index'
import {
  mutateOpenEditor,
  mutateOpenBlankEditor,
  mutateCloseEditor,
  mutateUpdateYaml,
  mutateSaveStart,
  mutateSaveSuccess,
  mutateSaveError,
  mutateForkStart,
  mutateForkSuccess,
  mutateForkError,
} from '../mutations/editorMutations'
import { mutateSelectEffect } from '../mutations/effectsMutations'
import { api } from '@/utils/api'
import { writeHash } from '@/utils/router'
import type { EffectManifest } from '@/types/api'
import type { AssetFile } from '../types'
import { loadEffects, selectEffect } from './effectsActions'

// ─── Constants ───────────────────────────────────────────────────────────────

const BLANK_TEMPLATE = `namespace: my
id: new-effect
name: New Effect
description: >
  Describe what this effect does.
version: "1.0.0"
author: me
type: animation
category: creative
tags:
  - custom

assets: {}

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
    - kling-v3
    - wan-2.2
  default_model: kling-v3

  prompt: >
    Cinematic effect on the subject. {prompt}
    High quality, 4K resolution.

  negative_prompt: >
    low quality, blurry, watermark

  defaults:
    duration: 5
    guidance_scale: 8.0
`

const BLANK_MANIFEST: EffectManifest = {
  namespace: 'my',
  id: 'new-effect',
  name: 'New Effect',
  description: 'Describe what this effect does.',
  version: '1.0.0',
  author: 'me',
  type: 'animation',
  category: 'creative',
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
    models: ['kling-v3', 'wan-2.2'],
    default_model: 'kling-v3',
    defaults: { duration: 5, guidance_scale: 8.0 },
    model_overrides: {},
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
    mutateOpenEditor(s, yaml, effectId, manifest, files)
  }, 'editor/open')
  writeHash(`effects/${effectId}/edit`)
}

export function openBlankEditor(): void {
  setState((s) => {
    mutateOpenBlankEditor(s, BLANK_TEMPLATE, BLANK_MANIFEST)
  }, 'editor/openBlank')
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
    mutateUpdateYaml(s, content)
  }, 'editor/updateYaml')
}

export async function saveEffect(): Promise<void> {
  const { yamlContent, editingEffectId } = getState().editor
  setState((s) => {
    mutateSaveStart(s)
  }, 'editor/saveStart')

  try {
    const result = await api.saveEffect(yamlContent, editingEffectId)
    const effectId = result.effect_id

    // Read current yaml again (user may have typed during save)
    const currentYaml = getState().editor.yamlContent
    setState((s) => {
      mutateSaveSuccess(s, effectId, result.manifest, currentYaml)
    }, 'editor/save')

    writeHash(`effects/${effectId}/edit`)

    // Reload effects list so gallery reflects changes
    await loadEffects()
    selectEffect(effectId, true)
  } catch (e) {
    setState((s) => {
      mutateSaveError(s, e instanceof Error ? e.message : 'Save failed')
    }, 'editor/saveFailed')
  }
}

export async function forkEffect(effect: EffectManifest): Promise<void> {
  setState((s) => {
    mutateForkStart(s)
  }, 'editor/forkStart')

  try {
    // Fetch the original YAML from the server (preserves formatting)
    const { yaml: originalYaml } = await api.getEffectEditorData(
      effect.namespace,
      effect.id,
    )

    // Modify namespace, id, and name in the YAML text
    const forkId = `${effect.id}-fork`
    const yamlContent = originalYaml
      .replace(/^namespace:\s*.+$/m, 'namespace: my')
      .replace(/^id:\s*.+$/m, `id: ${forkId}`)
      .replace(/^name:\s*.+$/m, `name: ${effect.name} (Fork)`)

    // Save the fork to the server (copy assets from source)
    const sourceId = `${effect.namespace}/${effect.id}`
    const result = await api.saveEffect(yamlContent, null, sourceId)
    const effectId = result.effect_id

    // Reload effects so it appears in the gallery
    await loadEffects()

    // Now open the editor with the saved fork
    const { yaml: savedYaml, files } = await api.getEffectEditorData(
      ...effectId.split('/') as [string, string],
    )

    setState((s) => {
      mutateForkSuccess(s, savedYaml, result.manifest, effectId, files)
      mutateSelectEffect(s, effectId)
    }, 'editor/fork')

    writeHash(`effects/${effectId}/edit`)
  } catch (e) {
    setState((s) => {
      mutateForkError(s, e instanceof Error ? e.message : 'Fork failed')
    }, 'editor/forkFailed')
  }
}

export async function editEffect(effect: EffectManifest): Promise<void> {
  const fullId = `${effect.namespace}/${effect.id}`
  try {
    const { yaml, files } = await api.getEffectEditorData(
      effect.namespace,
      effect.id,
    )
    openEditor(yaml, fullId, effect, files)
  } catch {
    // If fetching fails, fork instead
    forkEffect(effect)
  }
}
