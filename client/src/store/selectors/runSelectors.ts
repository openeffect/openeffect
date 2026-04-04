import { createSelector } from 'reselect'
import type { AppState } from '../types'

// ─── Base selectors ──────────────────────────────────────────────────────────

export const selectJobs = (s: AppState) => s.run.jobs
export const selectViewingJobId = (s: AppState) => s.run.viewingJobId
export const selectViewingRunRecord = (s: AppState) => s.run.viewingRunRecord
export const selectLeftPanel = (s: AppState) => s.run.leftPanel
export const selectRestoredParams = (s: AppState) => s.run.restoredParams
export const selectRestoringFromUrl = (s: AppState) => s.run.restoringFromUrl

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
