import { setState, getState } from '../index'
import {
  mutateSetHistory,
  mutateRemoveHistoryItem,
  mutateSetHistoryOpen,
  mutateSetHistoryStatus,
} from '../mutations/historyMutations'
import { mutateClearViewingJob } from '../mutations/generationMutations'
import { mutateSelectEffect } from '../mutations/effectsMutations'
import { api } from '@/utils/api'
import { writeHash } from '@/utils/router'

// Timer lives outside state — it's an implementation detail, not reactive state
let pollTimer: ReturnType<typeof setInterval> | null = null

export async function loadHistory(): Promise<void> {
  setState((s) => {
    mutateSetHistoryStatus(s, 'loading')
  }, 'history/loadStart')
  try {
    const data = await api.getGenerations()
    setState((s) => {
      mutateSetHistory(s, data.items, data.total, data.active_count)
      mutateSetHistoryStatus(s, 'succeeded')
    }, 'history/load')
    if (data.active_count === 0) {
      stopPolling()
    }
  } catch {
    setState((s) => {
      mutateSetHistoryStatus(s, 'failed')
    }, 'history/loadFailed')
  }
}

export async function deleteHistoryItem(id: string): Promise<void> {
  try {
    await api.deleteGeneration(id)
    setState((s) => {
      mutateRemoveHistoryItem(s, id)
      // Close everything if we just deleted the one being viewed
      if (s.generation.viewingJobId === id) {
        mutateClearViewingJob(s)
        mutateSelectEffect(s, null)
      }
    }, 'history/delete')
    // Clean up URL if we were viewing the deleted item
    const viewingJobId = getState().generation.viewingJobId
    if (viewingJobId === null) {
      writeHash(null)
    }
  } catch {
    // API failed — don't remove from local state
  }
}

export function openHistory(): void {
  setState((s) => {
    mutateSetHistoryOpen(s, true)
  }, 'history/open')
  loadHistory()
  startPolling()
}

export function closeHistory(): void {
  setState((s) => {
    mutateSetHistoryOpen(s, false)
  }, 'history/close')
  stopPolling()
}

export function openHistoryItem(id: string): void {
  window.location.hash = `#generations/${id}`
  closeHistory()
}

export function startPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    const s = getState()
    if (s.history.isOpen && s.history.activeCount > 0) {
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
