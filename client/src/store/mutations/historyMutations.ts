import type { AppState } from '../types'
import type { GenerationRecord } from '@/types/api'

export function mutateSetHistory(
  s: AppState,
  items: GenerationRecord[],
  total: number,
  activeCount: number,
) {
  s.history.items = items
  s.history.total = total
  s.history.activeCount = activeCount
}

export function mutateRemoveHistoryItem(s: AppState, id: string) {
  s.history.items = s.history.items.filter((i) => i.id !== id)
  s.history.total = Math.max(0, s.history.total - 1)
}

export function mutateSetHistoryOpen(s: AppState, isOpen: boolean) {
  s.history.isOpen = isOpen
}

export function mutateSetHistoryStatus(s: AppState, status: AppState['history']['status']) {
  s.history.status = status
}
