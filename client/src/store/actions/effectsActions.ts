import { setState, getState } from '../index'
import { mutateSelectEffect } from '../mutations/effectsMutations'
import { mutateClearViewingJob } from '../mutations/runMutations'
import { mutateCloseEditor } from '../mutations/editorMutations'
import { restoreFromUrl } from './runActions'
import { openEditor, openBlankEditor } from './editorActions'
import { openPlayground } from './playgroundActions'
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
        // Initial page load — right panel was never open before, so auto-apply
        // the run's params to the form (no risk of overriding user data).
        restoreFromUrl(route.runId, true).then((effectId) => {
          if (effectId) selectEffect(effectId, true)
        })
      }
    } else if (route.page === 'edit') {
      restoreEditor(route.effectId, effects)
    } else if (route.page === 'newEffect') {
      openBlankEditor(true)
    } else if (route.page === 'playground') {
      openPlayground(true)
      if (route.runId) {
        restoreFromUrl(route.runId, true)
      }
    }

    setState((s) => {
      s.effects.items = effects
      s.effects.status = 'succeeded'
      mutateSelectEffect(s, selectedId)
    }, 'effects/load')

    initRouteListener(
      (dbId, runId) => {
        // Capture "was the right side panel open" BEFORE mutating state, so
        // we can decide whether to auto-apply the run's params to the form.
        // Right panel is "open" if any of: effect selected, editor open, or
        // playground open. If it wasn't open, treat this as a fresh open and
        // auto-apply (no form data to override).
        const before = getState()
        const wasRightOpen =
          !!before.effects.selectedId || before.editor.isOpen || before.playground.isOpen
        setState((s) => {
          mutateCloseEditor(s)
          s.playground.isOpen = false
          mutateSelectEffect(s, dbId)
        }, 'router/effect')
        if (runId) {
          restoreFromUrl(runId, !wasRightOpen)
        }
      },
      (dbId) => restoreEditor(dbId),
      () => {
        setState((s) => {
          mutateClearViewingJob(s)
          mutateCloseEditor(s)
          s.playground.isOpen = false
          mutateSelectEffect(s, null)
        }, 'router/gallery')
      },
      (runId) => {
        // If we're transitioning INTO playground from elsewhere, do a clean open
        // (clears effect/editor/run). If we're already on playground, this is just
        // a URL update from Generate or back/forward — leave the active job alone.
        const before = getState()
        const wasRightOpen =
          !!before.effects.selectedId || before.editor.isOpen || before.playground.isOpen
        if (!before.playground.isOpen) {
          openPlayground(true)
        }
        if (runId) restoreFromUrl(runId, !wasRightOpen)
      },
      () => {
        // /effects/new — open the blank editor without re-pushing to history
        if (!getState().editor.isOpen) {
          openBlankEditor(true)
        }
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
  setState((s) => { s.effects.activeType = type }, 'effects/setActiveType')
}

export async function toggleFavorite(effect: EffectManifest): Promise<void> {
  const newValue = !effect.is_favorite
  // Optimistic update
  setState((s) => {
    const item = s.effects.items.find((e) => e.db_id === effect.db_id)
    if (item) item.is_favorite = newValue
  }, 'effects/toggleFavorite')

  try {
    await api.toggleFavorite(effect.namespace, effect.id, newValue)
  } catch {
    // Revert on failure
    setState((s) => {
      const item = s.effects.items.find((e) => e.db_id === effect.db_id)
      if (item) item.is_favorite = !newValue
    }, 'effects/toggleFavoriteRevert')
  }
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
