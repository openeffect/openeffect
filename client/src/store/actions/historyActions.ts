import { setState, getState } from '../index'
import { mutateClearViewingJob, mutateSetViewingRunRecord } from '../mutations/runMutations'
import { mutateSelectEffect } from '../mutations/effectsMutations'
import { api } from '@/utils/api'
import { navigate } from '@/utils/router'

/** Look up the DB UUID for an effect by its namespace/id. Falls back to the fullId itself (for orphaned effects). */
function effectDbId(fullId: string): string {
  const effects = getState().effects.items
  const effect = effects.find((e) => `${e.namespace}/${e.id}` === fullId)
  return effect?.db_id ?? fullId
}

// Timer lives outside state — it's an implementation detail, not reactive state
let pollTimer: ReturnType<typeof setInterval> | null = null

// ─── Global history (header popup) ──────────────────────────────────────────

export async function loadHistory(offset = 0): Promise<void> {
  setState((s) => { s.history.status = 'loading' }, 'history/loadStart')
  try {
    const data = await api.getRuns(50, offset)
    setState((s) => {
      if (offset === 0) {
        s.history.items = data.items
        s.history.total = data.total
        s.history.activeCount = data.active_count
      } else {
        s.history.items = [...s.history.items, ...data.items]
        s.history.total = data.total
        s.history.activeCount = data.active_count
      }
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
      s.history.items = s.history.items.filter((i) => i.id !== id)
      s.history.total = Math.max(0, s.history.total - 1)
      s.history.effectItems = s.history.effectItems.filter((i) => i.id !== id)
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

export function openHistoryItem(item: { id: string; effect_id: string }): void {
  closeHistory()
  navigate(`/effects/${effectDbId(item.effect_id)}`, { run: item.id })
}

export function startPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    const s = getState()
    if (s.history.isOpen && s.history.activeCount > 0 && s.history.status !== 'loading') {
      loadHistory()
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

export async function loadEffectHistory(effectId: string, offset = 0): Promise<void> {
  setState((s) => { s.history.effectStatus = 'loading' }, 'history/effectLoadStart')

  try {
    const data = await api.getRuns(20, offset, effectId)
    setState((s) => {
      if (offset === 0) {
        s.history.effectItems = data.items
        s.history.effectTotal = data.total
        s.history.effectId = effectId
      } else {
        s.history.effectItems = [...s.history.effectItems, ...data.items]
      }
      s.history.effectStatus = 'succeeded'
    }, 'history/effectLoad')
  } catch {
    setState((s) => { s.history.effectStatus = 'failed' }, 'history/effectLoadFailed')
  }
}

export function clearEffectHistory(): void {
  setState((s) => {
    s.history.effectItems = []
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
    navigate(`/effects/${effectDbId(effectFullId)}`, { run: runId })
  } catch (e) {
    console.error('Failed to load run:', e)
  }
}

export async function deleteRunFromHistory(runId: string, effectFullId: string): Promise<void> {
  try {
    await api.deleteRun(runId)
    setState((s) => {
      s.history.items = s.history.items.filter((i) => i.id !== runId)
      s.history.total = Math.max(0, s.history.total - 1)
      s.history.effectItems = s.history.effectItems.filter((i) => i.id !== runId)
      if (s.run.viewingRunRecord?.id === runId || s.run.viewingJobId === runId) {
        mutateClearViewingJob(s)
      }
    }, 'history/deleteRun')
    navigate(`/effects/${effectDbId(effectFullId)}`)
    await loadEffectHistory(effectFullId)
  } catch {
    // API failed
  }
}
