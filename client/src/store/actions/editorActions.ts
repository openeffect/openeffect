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

/** Matches the manifest's `id: namespace/slug` line. Used by saveEffect
 *  to surgically patch the id when the server auto-suffixes on a slug
 *  collision, without disturbing any other lines the user may have
 *  edited while save was in flight. */
const ID_LINE_RE = /^id:\s*(.+)$/m

const BLANK_TEMPLATE = `manifest_version: 1

id: my/new-effect
name: New Effect
description: >
  Describe what this effect does.

version: "0.1.0"
author: me
category: transform

tags:
  - custom

showcases:
  - preview: preview.mp4
    inputs:
      image: input-image.jpg

inputs:
  image:
    type: image
    role: start_frame
    required: true
    label: "Your photo"
    hint: "Upload a photo to use"

  scene_prompt:
    type: text
    required: false
    label: "Describe the scene"
    placeholder: "A cinematic shot..."
    hint: "Briefly describe what's in the input image — extra context like subject, setting, or time of day helps the model preserve the scene more faithfully"
    max_length: 500
    multiline: false

generation:
  models:
    - kling-3.0
    - wan-2.7

  default_model: kling-3.0

  prompt: >
    Cinematic effect on the subject.
    {% if scene_prompt %}Scene description: {{ scene_prompt }}{% endif %}
    High quality, 4K resolution.

  negative_prompt: >
    low quality, blurry, watermark

  params:
    duration: 5
`

const BLANK_MANIFEST: EffectManifest = {
  manifest_version: 1,
  id: '',
  full_id: 'my/new-effect',
  compatible_models: [],
  is_favorite: false,
  namespace: 'my',
  slug: 'new-effect',
  name: 'New Effect',
  description: 'Describe what this effect does.',
  version: '0.1.0',
  author: 'me',
  category: 'transform',
  tags: ['custom'],
  showcases: [],
  inputs: {
    image: {
      type: 'image',
      role: 'start_frame',
      required: true,
      label: 'Your photo',
      hint: 'Upload a photo to use',
    },
    scene_prompt: {
      type: 'text',
      required: false,
      label: 'Describe the scene',
      placeholder: 'A cinematic shot...',
      hint: "Briefly describe what's in the input image — extra context like subject, setting, or time of day helps the model preserve the scene more faithfully",
      max_length: 500,
      multiline: false,
    },
  },
  generation: {
    prompt: "Cinematic effect on the subject. {% if scene_prompt %}Scene description: {{ scene_prompt }}{% endif %} High quality, 4K resolution.",
    negative_prompt: 'low quality, blurry, watermark',
    models: ['kling-3.0', 'wan-2.7'],
    default_model: 'kling-3.0',
    params: { duration: { default: 5 } },
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
    // Snapshot the YAML we're sending so we can later detect whether
    // the user kept typing during the round-trip.
    const submittedYaml = yamlContent
    const result = await api.saveEffect(submittedYaml, editingEffectId)
    const effectId = result.manifest.id
    const savedFullId = `${result.manifest.namespace}/${result.manifest.slug}`

    setState((s) => {
      // Upsert the saved manifest. New effects go to the front (matches the
      // server's newest-first order); re-saves keep their current position.
      if (s.effects.items.has(effectId)) {
        s.effects.items.set(effectId, result.manifest)
      } else {
        s.effects.items = new Map([[effectId, result.manifest], ...s.effects.items])
      }
      s.editor.editingEffectId = effectId
      s.editor.savedManifest = result.manifest

      // Reconcile the textarea with the saved id. The server can rewrite
      // the id line on a fresh-effect collision (e.g. `my/foo` →
      // `my/foo-2`); other lines come back exactly as submitted. So
      // only patch the id line, and only if the user hasn't touched it
      // since save started — that way edits to other fields made while
      // save was in flight stay intact, and a deliberate id rename
      // mid-save isn't clobbered.
      const submittedId = ID_LINE_RE.exec(submittedYaml)?.[1]?.trim()
      const currentId = ID_LINE_RE.exec(s.editor.yamlContent)?.[1]?.trim()
      if (submittedId && currentId === submittedId && submittedId !== savedFullId) {
        s.editor.yamlContent = s.editor.yamlContent.replace(
          ID_LINE_RE,
          `id: ${savedFullId}`,
        )
      }
      // The canonical "last saved" content is what we submitted with
      // its id line rewritten — same transformation the server applies.
      // Reconstructing it locally avoids round-tripping the full YAML.
      s.editor.lastSavedYaml = submittedYaml.replace(
        ID_LINE_RE,
        `id: ${savedFullId}`,
      )
      s.editor.isSaving = false
      s.editor.saveVersion++
    }, 'editor/save')

    replaceRoute(`/effects/${effectId}/edit`)
    selectEffect(effectId, true)
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
    const { yaml: originalYaml } = await api.getEffectEditorData(effect.namespace, effect.slug)

    const forkSlug = `${effect.slug}-copy`
    const yamlContent = originalYaml
      .replace(/^id:\s*.+$/m, `id: my/${forkSlug}`)
      .replace(/^name:\s*.+$/m, `name: ${effect.name} (Copy)`)

    const result = await api.saveEffect(yamlContent, null, effect.full_id)
    const effectId = result.manifest.id

    const { yaml: savedYaml, files } = await api.getEffectEditorData(
      result.manifest.namespace,
      result.manifest.slug,
    )

    setState((s) => {
      // Insert the new fork at the front so it appears at the top of the
      // gallery — matches the server's newest-first order.
      s.effects.items = new Map([[effectId, result.manifest], ...s.effects.items])
      mutateClearViewingJob(s)
      s.editor.yamlContent = savedYaml
      s.editor.lastSavedYaml = savedYaml
      s.editor.savedManifest = result.manifest
      s.editor.editingEffectId = effectId
      s.editor.assetFiles = files
      s.editor.isOpen = true
      s.editor.isForking = false
      s.editor.saveVersion++
      mutateSelectEffect(s, effectId)
    }, 'editor/fork')

    replaceRoute(`/effects/${effectId}/edit`)
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
    const forkSlug = `${manifest.slug}-copy`
    const forkData = {
      ...manifest,
      id: `my/${forkSlug}`,
      namespace: 'my',
      slug: forkSlug,
      name: `${manifest.name} (Copy)`,
      showcases: [],
    }
    const yamlContent = manifestToYaml(forkData as unknown as Record<string, unknown>)

    const result = await api.saveEffect(yamlContent, null)
    const effectId = result.manifest.id

    const { yaml: savedYaml, files } = await api.getEffectEditorData(
      result.manifest.namespace,
      result.manifest.slug,
    )

    setState((s) => {
      // Insert the new fork at the front so it appears at the top of the
      // gallery — matches the server's newest-first order.
      s.effects.items = new Map([[effectId, result.manifest], ...s.effects.items])
      mutateClearViewingJob(s)
      s.editor.yamlContent = savedYaml
      s.editor.lastSavedYaml = savedYaml
      s.editor.savedManifest = result.manifest
      s.editor.editingEffectId = effectId
      s.editor.assetFiles = files
      s.editor.isOpen = true
      s.editor.isForking = false
      s.editor.saveVersion++
      mutateSelectEffect(s, effectId)
    }, 'editor/forkFromManifest')

    replaceRoute(`/effects/${effectId}/edit`)
  } catch (e) {
    setState((s) => {
      s.editor.isForking = false
      s.editor.saveError = e instanceof Error ? e.message : 'Duplicate failed'
    }, 'editor/forkFromManifestFailed')
  }
}

export async function editEffect(effect: EffectManifest): Promise<void> {
  try {
    const { yaml, files } = await api.getEffectEditorData(effect.namespace, effect.slug)
    openEditor(yaml, effect.id, effect, files)
  } catch {
    forkEffect(effect)
  }
}

// ─── Asset list mutations ────────────────────────────────────────────────────

/** Append an asset to the editor's pending list. The associated file row
 *  must already exist on the server (uploaded via /api/files). The save
 *  endpoint will bind it to the effect on the next save. */
export function addEditorAsset(file: AssetFile): void {
  setState((s) => {
    s.editor.assetFiles = [...s.editor.assetFiles, file]
  }, 'editor/asset/add')
}

/** Drop an asset by filename. The underlying file row stays — its
 *  ref_count just drops by one when the next save runs. */
export function removeEditorAsset(filename: string): void {
  setState((s) => {
    s.editor.assetFiles = s.editor.assetFiles.filter((f) => f.filename !== filename)
  }, 'editor/asset/remove')
}

/** Rename an asset's logical filename. The underlying file (and hash)
 *  is unchanged — only the (filename → hash) mapping that gets sent at
 *  save time. */
export function renameEditorAsset(oldName: string, newName: string): void {
  setState((s) => {
    s.editor.assetFiles = s.editor.assetFiles.map((f) =>
      f.filename === oldName ? { ...f, filename: newName } : f,
    )
  }, 'editor/asset/rename')
}
