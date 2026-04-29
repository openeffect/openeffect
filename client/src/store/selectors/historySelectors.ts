import { createSelector } from 'reselect'
import type { AppState } from '../types'

// All three collections are stored as Map<id, RunRecord> with insertion order
// preserved (matches the server's created_at DESC sort). Selectors expose
// memoized array views to components so `.map()` in render stays cheap - the
// array is recomputed only when the underlying Map reference changes (immer
// replaces the Map on every mutation).

// ─── Global history (header popup) ──────────────────────────────────────────

export const selectHistoryItems = createSelector(
  (s: AppState) => s.history.items,
  (map) => Array.from(map.values()),
)
export const selectHistoryTotal = (s: AppState) => s.history.total
export const selectHistoryActiveCount = (s: AppState) => s.history.activeCount
export const selectHistoryStatus = (s: AppState) => s.history.status
export const selectHistoryIsOpen = (s: AppState) => s.history.isOpen

// ─── Per-effect history (right panel tab) ───────────────────────────────────

export const selectEffectHistoryItems = createSelector(
  (s: AppState) => s.history.effectItems,
  (map) => Array.from(map.values()),
)
export const selectEffectHistoryTotal = (s: AppState) => s.history.effectTotal
export const selectEffectHistoryStatus = (s: AppState) => s.history.effectStatus
export const selectEffectHistoryId = (s: AppState) => s.history.effectId

// ─── Playground history (right panel tab) ───────────────────────────────────

export const selectPlaygroundHistoryItems = createSelector(
  (s: AppState) => s.history.playgroundItems,
  (map) => Array.from(map.values()),
)
export const selectPlaygroundHistoryTotal = (s: AppState) => s.history.playgroundTotal
export const selectPlaygroundHistoryStatus = (s: AppState) => s.history.playgroundStatus
