import { createSelector } from 'reselect'
import type { AppState } from '../types'

// ─── Base selectors ──────────────────────────────────────────────────────────

export const selectJobs = (s: AppState) => s.generation.jobs
export const selectViewingJobId = (s: AppState) => s.generation.viewingJobId
export const selectLeftPanel = (s: AppState) => s.generation.leftPanel
export const selectRestoredParams = (s: AppState) => s.generation.restoredParams
export const selectRestoringFromUrl = (s: AppState) => s.generation.restoringFromUrl

// ─── Derived selectors ───────────────────────────────────────────────────────

export const selectViewingJob = createSelector(
  selectJobs,
  selectViewingJobId,
  (jobs, id) => (id ? (jobs.get(id) ?? null) : null),
)

export const selectActiveJobCount = createSelector(
  selectJobs,
  (jobs) => {
    let count = 0
    for (const job of jobs.values()) {
      if (job.status === 'processing') count++
    }
    return count
  },
)
