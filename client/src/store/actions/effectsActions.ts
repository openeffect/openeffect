import { setState, getState } from '../index'
import {
  mutateSetEffects,
  mutateSetEffectsStatus,
  mutateSelectEffect,
  mutateSetSearchQuery,
  mutateSetActiveSource,
  mutateSetActiveCategory,
} from '../mutations/effectsMutations'
import { mutateClearViewingJob } from '../mutations/generationMutations'
import { mutateCloseEditor } from '../mutations/editorMutations'
import { restoreFromUrl } from './generationActions'
import { openEditor } from './editorActions'
import { api } from '@/utils/api'
import { parseHash, writeHash, initPopstateListener } from '@/utils/router'
import type { EffectManifest } from '@/types/api'
import type { EffectSource } from '../types'

function isValidEffectId(effects: EffectManifest[], id: string): boolean {
  return effects.some((e) => `${e.namespace}/${e.id}` === id)
}

async function restoreEditor(effectId: string): Promise<void> {
  try {
    const [ns, id] = effectId.split('/')
    if (!ns || !id) return
    const { yaml, files } = await api.getEffectEditorData(ns, id)
    const effects = getState().effects.items
    const manifest = effects.find((e) => `${e.namespace}/${e.id}` === effectId)
    openEditor(yaml, effectId, manifest, files)
    selectEffect(effectId, true)
  } catch {
    writeHash(null)
  }
}

export async function loadEffects(): Promise<void> {
  setState((s) => {
    mutateSetEffectsStatus(s, 'loading', null)
  }, 'effects/loadStart')

  try {
    const effects = await api.getEffects()

    // After loading, check if URL hash points to a valid effect or generation
    const parsed = parseHash()
    let selectedId: string | null = null

    if (parsed?.mode === 'effect' && isValidEffectId(effects, parsed.id)) {
      selectedId = parsed.id
    } else if (parsed?.mode === 'edit') {
      restoreEditor(parsed.id)
    } else if (parsed?.mode === 'generation') {
      restoreFromUrl(parsed.id).then((effectId) => {
        if (effectId) selectEffect(effectId, true)
      })
    }

    setState((s) => {
      mutateSetEffects(s, effects)
      mutateSetEffectsStatus(s, 'succeeded')
      mutateSelectEffect(s, selectedId)
    }, 'effects/load')

    // Wire up popstate listener now that effects are loaded
    initPopstateListener(
      (id) => {
        setState((s) => {
          mutateCloseEditor(s)
          mutateSelectEffect(s, id)
        }, 'router/effect')
      },
      (id) => restoreEditor(id),
      (id) => {
        restoreFromUrl(id).then((effectId) => {
          if (effectId) selectEffect(effectId, true)
        })
      },
      () => {
        setState((s) => {
          mutateClearViewingJob(s)
          mutateCloseEditor(s)
          mutateSelectEffect(s, null)
        }, 'router/empty')
      },
      (id) => isValidEffectId(getState().effects.items, id),
    )
  } catch (e) {
    setState((s) => {
      mutateSetEffectsStatus(
        s,
        'failed',
        e instanceof Error ? e.message : 'Failed to load effects',
      )
    }, 'effects/loadFailed')
  }
}

export function selectEffect(id: string | null, skipHash?: boolean): void {
  if (!skipHash) {
    writeHash(id ? `effects/${id}` : null)
  }
  setState((s) => {
    mutateSelectEffect(s, id)
    if (id === null) {
      mutateClearViewingJob(s)
    }
  }, 'effects/select')
}

export function setSearchQuery(query: string): void {
  setState((s) => {
    mutateSetSearchQuery(s, query)
  }, 'effects/setSearchQuery')
}

export function setActiveSource(source: EffectSource): void {
  setState((s) => {
    mutateSetActiveSource(s, source)
  }, 'effects/setActiveSource')
}

export function setActiveCategory(category: string): void {
  setState((s) => {
    mutateSetActiveCategory(s, category)
  }, 'effects/setActiveCategory')
}

export async function deleteEffect(
  namespace: string,
  id: string,
): Promise<void> {
  try {
    await api.uninstallEffect(namespace, id)
    setState((s) => {
      mutateCloseEditor(s)
      mutateSelectEffect(s, null)
    }, 'effects/delete')
    await loadEffects()
  } catch {
    // API failed — don't mutate state
  }
}
