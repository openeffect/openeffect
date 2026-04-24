import { setState, getState } from '../index'
import { mutateSelectEffect, mutateSetFilters } from '../mutations/effectsMutations'
import { mutateClearViewingJob } from '../mutations/runMutations'
import { mutateCloseEditor } from '../mutations/editorMutations'
import { restoreFromUrl } from './runActions'
import { openEditor, openBlankEditor } from './editorActions'
import { openPlayground } from './playgroundActions'
import { bootstrap as bootstrapSse } from '../sseManager'
import { api } from '@/utils/api'
import { parseRoute, navigate, replaceRoute, initRouteListener } from '@/utils/router'
import type { EffectManifest } from '@/types/api'
import type { EffectSource } from '../types'

async function restoreEditor(effectId: string, preloaded?: EffectManifest[]): Promise<void> {
  try {
    const manifest = preloaded
      ? preloaded.find((e) => e.id === effectId) ?? null
      : getState().effects.items.get(effectId) ?? null
    if (!manifest) { navigate('/'); return }
    const { yaml, files } = await api.getEffectEditorData(manifest.namespace, manifest.slug)
    openEditor(yaml, effectId, manifest, files)
    selectEffect(effectId, true)
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
      if (effects.some((e) => e.id === route.effectId)) {
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
      s.effects.items = new Map(effects.map((e) => [e.id, e]))
      s.effects.status = 'succeeded'
      mutateSelectEffect(s, selectedId)
      // Seed filters + search from the URL so a fresh page load with query
      // params lands in a filtered/searched gallery.
      if ('category' in route && 'source' in route) {
        mutateSetFilters(s, { category: route.category, source: route.source, search: route.search })
      }
    }, 'effects/load')

    // Rediscover any jobs still running on the server (survives a refresh)
    // and start streaming their progress into the store. Fire-and-forget.
    void bootstrapSse()

    initRouteListener(
      (effectId, runId, filters) => {
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
          // Arriving at /effects/{id} without a runId means the user isn't
          // viewing a specific run — drop any lingering restoredParams /
          // viewingRunRecord from a prior context (e.g. back-nav from
          // playground, whose `restoredParams.inputs` carries
          // `prompt`/`negative_prompt` keys that don't match any effect
          // manifest and would otherwise show up as "Previous parameters").
          if (!runId) {
            mutateClearViewingJob(s)
          }
          mutateSelectEffect(s, effectId)
          mutateSetFilters(s, filters)
        }, 'router/effect')
        if (runId) {
          restoreFromUrl(runId, !wasRightOpen)
        }
      },
      (effectId, filters) => {
        setState((s) => { mutateSetFilters(s, filters) }, 'router/edit')
        restoreEditor(effectId)
      },
      (filters) => {
        setState((s) => {
          mutateClearViewingJob(s)
          mutateCloseEditor(s)
          s.playground.isOpen = false
          mutateSelectEffect(s, null)
          mutateSetFilters(s, filters)
        }, 'router/gallery')
      },
      (runId, filters) => {
        // If we're transitioning INTO playground from elsewhere, do a clean open
        // (clears effect/editor/run). If we're already on playground, this is just
        // a URL update from Generate or back/forward — leave the active job alone.
        const before = getState()
        const wasRightOpen =
          !!before.effects.selectedId || before.editor.isOpen || before.playground.isOpen
        if (!before.playground.isOpen) {
          openPlayground(true)
        }
        setState((s) => { mutateSetFilters(s, filters) }, 'router/playground')
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

export function selectEffect(effectId: string | null, skipNav?: boolean): void {
  if (!skipNav) {
    navigate(effectId ? `/effects/${effectId}` : '/')
  }
  setState((s) => {
    mutateSelectEffect(s, effectId)
    if (effectId === null) {
      mutateClearViewingJob(s)
    }
  }, 'effects/select')
}

/** Debounced URL sync for the search input — `replaceState` (not `pushState`)
 *  so typing doesn't fill the Back button with one history entry per
 *  keystroke, but a reload or share still preserves the query. */
let searchDebounce: ReturnType<typeof setTimeout> | null = null
const SEARCH_DEBOUNCE_MS = 250

export function setSearchQuery(query: string): void {
  // Update store synchronously so the input stays responsive and filtered
  // results render live.
  setState((s) => { s.effects.searchQuery = query }, 'effects/setSearchQuery')

  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    if (typeof window === 'undefined') return
    replaceRoute(window.location.pathname, { search: query || undefined })
  }, SEARCH_DEBOUNCE_MS)
}

/** URL is the source of truth for gallery filters. Clicking a filter pill
 *  or the "View all" tile updates the query param on the CURRENT path
 *  (gallery or deep route) — so clearing a filter from an effect page
 *  doesn't close the effect, and the popstate listener above writes the
 *  new values into the store via mutateSetFilters. */
export function setActiveSource(source: EffectSource): void {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  navigate(pathname, { source })
}

export function setActiveCategory(category: string): void {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  navigate(pathname, { category })
}

export async function toggleFavorite(effect: EffectManifest): Promise<void> {
  const newValue = !effect.is_favorite
  // Optimistic update
  setState((s) => {
    const item = s.effects.items.get(effect.id)
    if (item) item.is_favorite = newValue
  }, 'effects/toggleFavorite')

  try {
    await api.toggleFavorite(effect.namespace, effect.slug, newValue)
  } catch {
    // Revert on failure
    setState((s) => {
      const item = s.effects.items.get(effect.id)
      if (item) item.is_favorite = !newValue
    }, 'effects/toggleFavoriteRevert')
  }
}

/** Flip an effect between editable (`source: 'local'`) and read-only
 *  (`source: 'archive'`). Matches what the server does on its side
 *  (see `toggle_editable` in `server/routes/effects.py`). Patches the
 *  local Map in place — no list-wide refetch — so the gallery and
 *  manager dialog don't flash. */
export async function setEffectEditable(
  effect: EffectManifest,
  editable: boolean,
): Promise<void> {
  await api.setEditable(effect.namespace, effect.slug, editable)
  setState((s) => {
    const item = s.effects.items.get(effect.id)
    if (item) item.source = editable ? 'local' : 'archive'
  }, 'effects/setEditable')
}

export async function deleteEffect(namespace: string, slug: string): Promise<void> {
  try {
    await api.uninstallEffect(namespace, slug)
    setState((s) => {
      // Locate the deleted effect in the Map so we can drop it and any
      // caches that referenced it without refetching the whole list.
      let deletedId: string | null = null
      for (const [effectId, effect] of s.effects.items) {
        if (effect.namespace === namespace && effect.slug === slug) {
          deletedId = effectId
          break
        }
      }
      if (deletedId) s.effects.items.delete(deletedId)

      mutateCloseEditor(s)
      mutateSelectEffect(s, null)

      // History may still reference runs of the now-deleted effect — drop
      // the global cache so the next open refetches. If the per-effect
      // history slice was loaded for this effect, drop it too.
      s.history.status = 'idle'
      if (deletedId && s.history.effectId === deletedId) {
        s.history.effectStatus = 'idle'
        s.history.effectId = null
        s.history.effectItems = new Map()
      }
    }, 'effects/delete')
  } catch {
    // API failed — don't mutate state
  }
}
