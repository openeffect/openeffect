import type { AppState } from '../types'

// ─── Global history (header popup) ──────────────────────────────────────────

export const selectHistoryItems = (s: AppState) => s.history.items
export const selectHistoryTotal = (s: AppState) => s.history.total
export const selectHistoryActiveCount = (s: AppState) => s.history.activeCount
export const selectHistoryStatus = (s: AppState) => s.history.status
export const selectHistoryIsOpen = (s: AppState) => s.history.isOpen

// ─── Per-effect history (right panel tab) ───────────────────────────────────

export const selectEffectHistoryItems = (s: AppState) => s.history.effectItems
export const selectEffectHistoryTotal = (s: AppState) => s.history.effectTotal
export const selectEffectHistoryStatus = (s: AppState) => s.history.effectStatus
export const selectEffectHistoryId = (s: AppState) => s.history.effectId
