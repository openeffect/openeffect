import type { AppState, RestoredParams } from '../types'
import type { RunRecord } from '@/types/api'

/** Shared: used by runActions, historyActions, editorActions, effectsActions, appActions, RunView */
export function mutateClearViewingJob(s: AppState) {
  s.run.viewingJobId = null
  s.run.viewingRunRecord = null
  s.run.leftPanel = 'gallery'
  s.run.restoredParams = null
}

/** Shared: used by runActions, historyActions */
export function mutateSetViewingRunRecord(s: AppState, record: RunRecord | null) {
  s.run.viewingRunRecord = record
  if (record) {
    s.run.leftPanel = 'run-result'
  }
}

/** Shared: used by runActions, RunView */
export function mutateSetRestoredParams(s: AppState, params: RestoredParams | null) {
  s.run.restoredParams = params
}

/** Shared: used by runActions when applying params (Generate, Reuse, Apply-to-form). */
export function mutateSetLastAppliedRunId(s: AppState, id: string | null) {
  s.run.lastAppliedRunId = id
}
