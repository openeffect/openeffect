import type { AppState } from '../types'

export const selectHistoryItems = (s: AppState) => s.history.items
export const selectHistoryTotal = (s: AppState) => s.history.total
export const selectHistoryActiveCount = (s: AppState) => s.history.activeCount
export const selectHistoryStatus = (s: AppState) => s.history.status
export const selectHistoryIsOpen = (s: AppState) => s.history.isOpen
