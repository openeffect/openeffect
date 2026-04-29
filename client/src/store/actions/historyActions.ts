import { setState, getState } from '../index'
import { mutateClearViewingJob, mutateSetViewingRunRecord } from '../mutations/runMutations'
import { mutateSelectEffect } from '../mutations/effectsMutations'
import { api } from '@/utils/api'
import { navigate } from '@/utils/router'
import type { RunRecord } from '@/types/api'

/** Resolve an effect's UUID from its `namespace/slug`. Falls back to the
 *  fullId itself (for orphaned-effect history entries the UI still wants
 *  to render). */
function effectUuid(fullId: string): string {
  for (const effect of getState().effects.items.values()) {
    if (effect.full_id === fullId) return effect.id
  }
  return fullId
}

// Timer lives outside state — it's an implementation detail, not reactive state
let pollTimer: ReturnType<typeof setInterval> | null = null

// ─── Global history (header popup) ──────────────────────────────────────────

/**
 * Fetch the global run history.
 *
 * Cache: when `offset === 0` and the slice is already `succeeded`, returns
 * immediately without hitting the network. Pagination calls (`offset > 0`)
 * always fetch. Pass `force: true` to bypass the cache when fresh data is
 * needed (e.g. after a run completes, or during active polling).
 */
export async function loadHistory(offset = 0, force = false): Promise<void> {
  if (offset === 0 && !force && getState().history.status === 'succeeded') return

  setState((s) => { s.history.status = 'loading' }, 'history/loadStart')
  try {
    const data = await api.getRuns(50, offset)
    setState((s) => {
      if (offset === 0) {
        s.history.items = new Map(data.runs.map((r) => [r.id, r]))
      } else {
        // Map preserves insertion order — appending pages keeps newest-first
        for (const r of data.runs) s.history.items.set(r.id, r)
      }
      s.history.total = data.total
      s.history.activeCount = data.active_count
      s.history.status = 'succeeded'
    }, 'history/load')
    if (data.active_count === 0) {
      stopPolling()
    }
  } catch {
    setState((s) => { s.history.status = 'failed' }, 'history/loadFailed')
  }
}

export async function deleteHistoryItem(id: string): Promise<void> {
  try {
    await api.deleteRun(id)
    setState((s) => {
      const wasInPlayground = s.history.playgroundItems.has(id)
      s.history.items.delete(id)
      s.history.total = Math.max(0, s.history.total - 1)
      s.history.effectItems.delete(id)
      s.history.playgroundItems.delete(id)
      if (wasInPlayground) {
        s.history.playgroundTotal = Math.max(0, s.history.playgroundTotal - 1)
      }
      // Close if we just deleted the one being viewed
      if (s.run.viewingJobId === id || s.run.viewingRunRecord?.id === id) {
        mutateClearViewingJob(s)
        mutateSelectEffect(s, null)
      }
    }, 'history/delete')
    const { run } = getState()
    if (run.viewingJobId === null && run.viewingRunRecord === null) {
      navigate('/')
    }
  } catch {
    // API failed — don't remove from local state
  }
}

export function openHistory(): void {
  setState((s) => { s.history.isOpen = true }, 'history/open')
  loadHistory()
  startPolling()
}

export function closeHistory(): void {
  setState((s) => { s.history.isOpen = false }, 'history/close')
  stopPolling()
}

export function openHistoryItem(item: Pick<RunRecord, 'id' | 'effect_id' | 'kind'>): void {
  closeHistory()
  if (item.kind === 'playground') {
    // Playground runs land on /playground; the run gets restored via runId query param
    navigate('/playground', { run: item.id })
    return
  }
  if (!item.effect_id) {
    navigate('/')
    return
  }
  navigate(`/effects/${effectUuid(item.effect_id)}`, { run: item.id })
}

export function startPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    const s = getState()
    if (s.history.isOpen && s.history.activeCount > 0 && s.history.status !== 'loading') {
      // Polling's whole job is surfacing server-side changes to active runs —
      // always bypass the cache.
      loadHistory(0, true)
    } else {
      stopPolling()
    }
  }, 2000)
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// ─── Per-effect history (right panel tab) ───────────────────────────────────

/**
 * Fetch runs for a specific effect.
 *
 * Cache hit requires both `effectStatus === 'succeeded'` AND the cached
 * effect id to match — switching to a different effect always refetches.
 * Pass `force: true` to bypass (used after a run completes/fails for this effect).
 */
export async function loadEffectHistory(effectId: string, offset = 0, force = false): Promise<void> {
  const { effectStatus, effectId: cachedId } = getState().history
  if (offset === 0 && !force && effectStatus === 'succeeded' && cachedId === effectId) return

  const isEffectSwitch = offset === 0 && cachedId !== effectId

  setState((s) => {
    s.history.effectStatus = 'loading'
    // Switching effects → drop the previous effect's items so the UI shows
    // the loader instead of a brief flash of the previous effect's runs
    // (the EffectHistoryTab's loader gate is `loading && items.length === 0`,
    // so it needs the items cleared to fire). Same-effect refreshes
    // (force=true after a run completes) keep the existing list visible —
    // no blank-then-rehydrate flicker for runs that were already there.
    if (isEffectSwitch) {
      s.history.effectItems = new Map()
      s.history.effectTotal = 0
      s.history.effectId = effectId
    }
  }, 'history/effectLoadStart')

  try {
    const data = await api.getRuns(20, offset, effectId)
    setState((s) => {
      if (offset === 0) {
        s.history.effectItems = new Map(data.runs.map((r) => [r.id, r]))
        s.history.effectTotal = data.total
        s.history.effectId = effectId
      } else {
        for (const r of data.runs) s.history.effectItems.set(r.id, r)
      }
      s.history.effectStatus = 'succeeded'
    }, 'history/effectLoad')
  } catch {
    setState((s) => { s.history.effectStatus = 'failed' }, 'history/effectLoadFailed')
  }
}

/** Force-refresh every history cache that's already been loaded. Called on
 *  run start/complete/fail so any open history view (header popup, per-effect
 *  tab, playground tab) reflects the latest server state without a page
 *  reload. Untouched caches stay untouched — no point warming a cache the
 *  user hasn't opened yet. */
export function refreshLoadedHistories(): void {
  const { status, effectId, playgroundLoaded } = getState().history
  if (status === 'succeeded') loadHistory(0, true)
  if (effectId) loadEffectHistory(effectId, 0, true)
  if (playgroundLoaded) loadPlaygroundHistory(0, true)
}

export async function loadPlaygroundHistory(offset = 0, force = false): Promise<void> {
  if (offset === 0 && !force && getState().history.playgroundStatus === 'succeeded') return

  setState((s) => { s.history.playgroundStatus = 'loading' }, 'history/playgroundLoadStart')

  try {
    const data = await api.getRuns(20, offset, undefined, 'playground')
    setState((s) => {
      if (offset === 0) {
        s.history.playgroundItems = new Map(data.runs.map((r) => [r.id, r]))
        s.history.playgroundTotal = data.total
      } else {
        for (const r of data.runs) s.history.playgroundItems.set(r.id, r)
      }
      s.history.playgroundStatus = 'succeeded'
      s.history.playgroundLoaded = true
    }, 'history/playgroundLoad')
  } catch {
    setState((s) => { s.history.playgroundStatus = 'failed' }, 'history/playgroundLoadFailed')
  }
}

export function clearEffectHistory(): void {
  setState((s) => {
    s.history.effectItems = new Map()
    s.history.effectTotal = 0
    s.history.effectStatus = 'idle'
    s.history.effectId = null
  }, 'history/effectClear')
}

export async function openRunFromHistory(runId: string, effectFullId: string): Promise<void> {
  try {
    const record = await api.getRun(runId)
    setState((s) => {
      mutateSetViewingRunRecord(s, record)
    }, 'history/openRun')
    navigate(`/effects/${effectUuid(effectFullId)}`, { run: runId })
  } catch (e) {
    console.error('Failed to load run:', e)
  }
}

export async function deletePlaygroundRun(runId: string): Promise<void> {
  try {
    await api.deleteRun(runId)
    setState((s) => {
      const wasInPlayground = s.history.playgroundItems.has(runId)
      s.history.playgroundItems.delete(runId)
      if (wasInPlayground) {
        s.history.playgroundTotal = Math.max(0, s.history.playgroundTotal - 1)
      }
      s.history.items.delete(runId)
      if (wasInPlayground) {
        s.history.total = Math.max(0, s.history.total - 1)
      }
      if (s.run.viewingRunRecord?.id === runId || s.run.viewingJobId === runId) {
        mutateClearViewingJob(s)
      }
    }, 'history/deletePlaygroundRun')
  } catch {
    // API failed
  }
}

export async function deleteRunFromHistory(runId: string, effectFullId: string): Promise<void> {
  try {
    await api.deleteRun(runId)
    setState((s) => {
      s.history.items.delete(runId)
      s.history.total = Math.max(0, s.history.total - 1)
      s.history.effectItems.delete(runId)
      if (s.run.viewingRunRecord?.id === runId || s.run.viewingJobId === runId) {
        mutateClearViewingJob(s)
      }
    }, 'history/deleteRun')
    navigate(`/effects/${effectUuid(effectFullId)}`)
    // Local `.delete()` above is authoritative — no refetch needed
  } catch {
    // API failed
  }
}
