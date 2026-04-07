import type { RunSlice } from '../types'

export const initialRunState: RunSlice = {
  jobs: new Map(),
  viewingJobId: null,
  viewingRunRecord: null,
  leftPanel: 'gallery',
  restoredParams: null,
  restoringFromUrl: false,
  lastAppliedRunId: null,
}
