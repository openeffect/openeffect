import { setState, getState } from '../index'
import { mutateSelectEffect } from '../mutations/effectsMutations'
import { mutateClearViewingJob } from '../mutations/runMutations'
import { mutateCloseEditor } from '../mutations/editorMutations'
import { restoreFromUrl } from './runActions'
import { openEditor } from './editorActions'
import { api } from '@/utils/api'
import { parseRoute, navigate, initRouteListener } from '@/utils/router'
import type { EffectManifest } from '@/types/api'
import type { EffectSource } from '../types'

function findEffectByDbId(effects: EffectManifest[], dbId: string): EffectManifest | null {
  return effects.find((e) => e.db_id === dbId) ?? null
}

async function restoreEditor(dbId: string, effectsList?: EffectManifest[]): Promise<void> {
  try {
    const effects = effectsList ?? getState().effects.items
    const manifest = findEffectByDbId(effects, dbId)
    if (!manifest) { navigate('/'); return }
    const { yaml, files } = await api.getEffectEditorData(manifest.namespace, manifest.id)
    openEditor(yaml, dbId, manifest, files)
    selectEffect(dbId, true)
  } catch {
    navigate('/')
  }
}

export async function loadEffects(): Promise<void> {
  setState((s) => {
    s.effects.status = 'loading'
    s.effects.error = null
  }, 'effects/loadStart')

  try {
    const effects = await api.getEffects()

    const route = parseRoute()
    let selectedId: string | null = null

    if (route.page === 'effect') {
      if (effects.some((e) => e.db_id === route.effectId)) {
        selectedId = route.effectId
      }
      if (route.runId) {
        restoreFromUrl(route.runId).then((effectId) => {
          if (effectId) selectEffect(effectId, true)
        })
      }
    } else if (route.page === 'edit') {
      restoreEditor(route.effectId, effects)
    }

    setState((s) => {
      s.effects.items = effects
      s.effects.status = 'succeeded'
      mutateSelectEffect(s, selectedId)
    }, 'effects/load')

    initRouteListener(
      (dbId, runId) => {
        setState((s) => {
          mutateCloseEditor(s)
          mutateSelectEffect(s, dbId)
        }, 'router/effect')
        if (runId) {
          restoreFromUrl(runId)
        }
      },
      (dbId) => restoreEditor(dbId),
      () => {
        setState((s) => {
          mutateClearViewingJob(s)
          mutateCloseEditor(s)
          mutateSelectEffect(s, null)
        }, 'router/gallery')
      },
    )
  } catch (e) {
    setState((s) => {
      s.effects.status = 'failed'
      s.effects.error = e instanceof Error ? e.message : 'Failed to load effects'
    }, 'effects/loadFailed')
  }
}

export function selectEffect(dbId: string | null, skipNav?: boolean): void {
  if (!skipNav) {
    navigate(dbId ? `/effects/${dbId}` : '/')
  }
  setState((s) => {
    mutateSelectEffect(s, dbId)
    if (dbId === null) {
      mutateClearViewingJob(s)
    }
  }, 'effects/select')
}

export function setSearchQuery(query: string): void {
  setState((s) => { s.effects.searchQuery = query }, 'effects/setSearchQuery')
}

export function setActiveSource(source: EffectSource): void {
  setState((s) => { s.effects.activeSource = source }, 'effects/setActiveSource')
}

export function setActiveType(type: string): void {
  setState((s) => {
    s.effects.activeType = type
    s.effects.activeCategory = 'all'
  }, 'effects/setActiveType')
}

export function setActiveCategory(category: string): void {
  setState((s) => { s.effects.activeCategory = category }, 'effects/setActiveCategory')
}

export async function deleteEffect(namespace: string, id: string): Promise<void> {
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
