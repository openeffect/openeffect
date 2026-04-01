import { create } from 'zustand'
import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'
import { useEffectsStore } from '@/store/effectsStore'
import { writeHash } from '@/lib/router'

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

interface AssetFile {
  filename: string
  size: number
  url: string
}

interface EditorStore {
  yamlContent: string
  lastSavedYaml: string
  savedManifest: EffectManifest | null
  editingEffectId: string | null
  assetFiles: AssetFile[]
  isEditorOpen: boolean
  isSaving: boolean
  isForking: boolean
  saveError: string | null
  isDirty: () => boolean

  openEditor: (yaml: string, effectId: string, manifest?: EffectManifest, files?: AssetFile[]) => void
  openBlankEditor: () => void
  closeEditor: () => void
  confirmClose: () => boolean        // returns true if safe to close
  updateYaml: (content: string) => void
  saveEffect: () => Promise<void>
  forkEffect: (effect: EffectManifest) => Promise<void>
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  yamlContent: '',
  lastSavedYaml: '',
  savedManifest: null,
  editingEffectId: null,
  assetFiles: [],
  isEditorOpen: false,
  isSaving: false,
  isForking: false,
  saveError: null,
  isDirty: () => get().yamlContent !== get().lastSavedYaml,

  openEditor: (yamlContent: string, effectId: string, manifest?: EffectManifest, files?: AssetFile[]) => {
    set({
      yamlContent,
      lastSavedYaml: yamlContent,
      savedManifest: manifest ?? null,
      editingEffectId: effectId,
      assetFiles: files ?? [],
      isEditorOpen: true,
      saveError: null,
    })
    writeHash(`effects/${effectId}/edit`)
  },

  openBlankEditor: () => {
    set({
      yamlContent: BLANK_TEMPLATE,
      lastSavedYaml: BLANK_TEMPLATE,
      savedManifest: BLANK_MANIFEST,
      editingEffectId: null,
      isEditorOpen: true,
      saveError: null,
    })
  },

  closeEditor: () => {
    set({
      isEditorOpen: false,
      editingEffectId: null,
      savedManifest: null,
      assetFiles: [],
      saveError: null,
      lastSavedYaml: '',
    })
  },

  confirmClose: () => {
    if (!get().isDirty()) return true
    return window.confirm('You have unsaved changes. Discard them?')
  },

  updateYaml: (content: string) => {
    set({ yamlContent: content, saveError: null })
  },

  saveEffect: async () => {
    const { yamlContent, editingEffectId } = get()
    set({ isSaving: true, saveError: null })
    try {
      const result = await api.saveEffect(yamlContent, editingEffectId)
      // Server returns the parsed manifest + new effect_id
      const effectId = result.effect_id

      set({
        editingEffectId: effectId,
        savedManifest: result.manifest,
        lastSavedYaml: get().yamlContent,
        isSaving: false,
      })

      // Update URL to reflect the (potentially new) effect id
      writeHash(`effects/${effectId}/edit`)

      // Reload effects list so gallery reflects changes
      await useEffectsStore.getState().loadEffects()
      // Select the effect in the panel
      useEffectsStore.getState().selectEffect(effectId, true)
    } catch (e) {
      set({
        isSaving: false,
        saveError: e instanceof Error ? e.message : 'Save failed',
      })
    }
  },

  forkEffect: async (effect: EffectManifest) => {
    set({ isForking: true, saveError: null })
    try {
      // Fetch the original YAML from the server (preserves formatting, has real filenames)
      const { yaml: originalYaml } = await api.getEffectEditorData(effect.namespace, effect.id)

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
      await useEffectsStore.getState().loadEffects()

      // Now open the editor with the saved fork
      const { yaml: savedYaml, files } = await api.getEffectEditorData(...effectId.split('/') as [string, string])

      set({
        yamlContent: savedYaml,
        lastSavedYaml: savedYaml,
        savedManifest: result.manifest,
        editingEffectId: effectId,
        assetFiles: files,
        isEditorOpen: true,
        isForking: false,
      })

      writeHash(`effects/${effectId}/edit`)
      useEffectsStore.getState().selectEffect(effectId, true)
    } catch (e) {
      set({
        isForking: false,
        saveError: e instanceof Error ? e.message : 'Fork failed',
      })
    }
  },
}))

function manifestToYaml(m: Record<string, unknown>): string {
  const lines: string[] = []

  const scalarInline = (v: unknown): string => {
    if (typeof v === 'string') {
      if (v.match(/[:#{}[\],&*?|>!%@`]/)) return `"${v}"`
      return v
    }
    return String(v)
  }

  const writeValue = (key: string, value: unknown, indent: number) => {
    const pad = '  '.repeat(indent)
    if (value === null || value === undefined) return

    // Empty objects → write as `key: {}`
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) {
      lines.push(`${pad}${key}: {}`)
      return
    }

    // Empty arrays → write as `key: []`
    if (Array.isArray(value) && value.length === 0) {
      lines.push(`${pad}${key}: []`)
      return
    }

    if (typeof value === 'string' && (value.includes('\n') || value.length > 60)) {
      // Multi-line folded string
      const innerPad = '  '.repeat(indent + 1)
      lines.push(`${pad}${key}: >`)
      lines.push(`${innerPad}${value.replace(/\n/g, `\n${innerPad}`).trim()}`)
    } else if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`)
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          const entries = Object.entries(item as Record<string, unknown>)
          const [first, ...rest] = entries
          lines.push(`${pad}  - ${first![0]}: ${scalarInline(first![1])}`)
          for (const [k, v] of rest) {
            lines.push(`${pad}    ${k}: ${scalarInline(v)}`)
          }
        } else {
          lines.push(`${pad}  - ${scalarInline(item)}`)
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${pad}${key}:`)
      writeObj(value as Record<string, unknown>, indent + 1)
    } else {
      lines.push(`${pad}${key}: ${scalarInline(value)}`)
    }
  }

  const writeObj = (obj: Record<string, unknown>, indent: number) => {
    for (const [key, value] of Object.entries(obj)) {
      writeValue(key, value, indent)
    }
  }

  writeObj(m, 0)
  return lines.join('\n') + '\n'
}
