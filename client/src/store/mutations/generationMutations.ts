import type { AppState, ActiveJob, LeftPanel, RestoredParams } from '../types'

export function mutateAddJob(s: AppState, job: ActiveJob) {
  s.generation.jobs.set(job.jobId, job)
}

export function mutateUpdateJobProgress(
  s: AppState,
  jobId: string,
  progress: number,
  message: string,
) {
  const job = s.generation.jobs.get(jobId)
  if (job) {
    job.progress = progress
    job.message = message
  }
}

export function mutateCompleteJob(s: AppState, jobId: string, videoUrl: string) {
  const job = s.generation.jobs.get(jobId)
  if (job) {
    job.status = 'completed'
    job.progress = 100
    job.videoUrl = videoUrl
    job.message = null
  }
  if (s.generation.viewingJobId === jobId) {
    s.generation.leftPanel = 'result'
  }
}

export function mutateFailJob(s: AppState, jobId: string, error: string) {
  const job = s.generation.jobs.get(jobId)
  if (job) {
    job.status = 'failed'
    job.error = error
  }
}

export function mutateSetViewingJob(s: AppState, jobId: string, leftPanel: LeftPanel) {
  s.generation.viewingJobId = jobId
  s.generation.leftPanel = leftPanel
}

export function mutateClearViewingJob(s: AppState) {
  s.generation.viewingJobId = null
  s.generation.leftPanel = 'gallery'
  s.generation.restoredParams = null
}

export function mutateSetRestoredParams(s: AppState, params: RestoredParams | null) {
  s.generation.restoredParams = params
}

export function mutateSetRestoringFromUrl(s: AppState, value: boolean) {
  s.generation.restoringFromUrl = value
}
