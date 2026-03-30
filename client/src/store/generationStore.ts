import { create } from 'zustand'
import type { GenerationRequest } from '@/types/api'
import { api } from '@/lib/api'

interface ActiveJob {
  jobId: string
  effectName: string
  status: 'processing' | 'completed' | 'failed'
  progress: number
  message: string | null
  videoUrl: string | null
  error: string | null
}

type LeftPanel = 'gallery' | 'progress' | 'result'

interface GenerationStore {
  activeJobs: Map<string, ActiveJob>
  viewingJobId: string | null
  leftPanel: LeftPanel

  startGeneration: (request: GenerationRequest, effectName: string) => Promise<string>
  updateJobProgress: (jobId: string, progress: number, message: string) => void
  completeJob: (jobId: string, videoUrl: string) => void
  failJob: (jobId: string, error: string) => void
  openJob: (jobId: string) => void
  closeJob: () => void
  activeCount: () => number
}

export const useGenerationStore = create<GenerationStore>((set, get) => ({
  activeJobs: new Map(),
  viewingJobId: null,
  leftPanel: 'gallery',

  startGeneration: async (request, effectName) => {
    const response = await api.generate(request)
    const job: ActiveJob = {
      jobId: response.job_id,
      effectName,
      status: 'processing',
      progress: 0,
      message: 'Starting...',
      videoUrl: null,
      error: null,
    }
    const jobs = new Map(get().activeJobs)
    jobs.set(response.job_id, job)
    set({ activeJobs: jobs, viewingJobId: response.job_id, leftPanel: 'progress' })
    return response.job_id
  },

  updateJobProgress: (jobId, progress, message) => {
    const jobs = new Map(get().activeJobs)
    const job = jobs.get(jobId)
    if (job) {
      jobs.set(jobId, { ...job, progress, message })
      set({ activeJobs: jobs })
    }
  },

  completeJob: (jobId, videoUrl) => {
    const jobs = new Map(get().activeJobs)
    const job = jobs.get(jobId)
    if (job) {
      jobs.set(jobId, { ...job, status: 'completed', progress: 100, videoUrl })
      const updates: Partial<GenerationStore> = { activeJobs: jobs }
      if (get().viewingJobId === jobId) {
        updates.leftPanel = 'result'
      }
      set(updates as GenerationStore)
    }
  },

  failJob: (jobId, error) => {
    const jobs = new Map(get().activeJobs)
    const job = jobs.get(jobId)
    if (job) {
      jobs.set(jobId, { ...job, status: 'failed', error })
      set({ activeJobs: jobs })
    }
  },

  openJob: (jobId) => {
    const job = get().activeJobs.get(jobId)
    if (!job) return
    set({
      viewingJobId: jobId,
      leftPanel: job.status === 'completed' ? 'result' : 'progress',
    })
  },

  closeJob: () => {
    set({ viewingJobId: null, leftPanel: 'gallery' })
  },

  activeCount: () => {
    let count = 0
    for (const job of get().activeJobs.values()) {
      if (job.status === 'processing') count++
    }
    return count
  },
}))
