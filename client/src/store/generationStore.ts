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

interface RestoredParams {
  modelId: string
  inputs: Record<string, string>
  output: { aspect_ratio: string; duration: number }
  userParams?: Record<string, unknown>
}

interface GenerationStore {
  activeJobs: Map<string, ActiveJob>
  viewingJobId: string | null
  leftPanel: LeftPanel
  restoredParams: RestoredParams | null
  restoringFromUrl: boolean

  startGeneration: (request: GenerationRequest, effectName: string) => Promise<string>
  updateJobProgress: (jobId: string, progress: number, message: string) => void
  completeJob: (jobId: string, videoUrl: string) => void
  failJob: (jobId: string, error: string) => void
  openJob: (jobId: string) => void
  closeJob: () => void
  activeCount: () => number
  restoreFromUrl: (id: string) => Promise<void>
}

export const useGenerationStore = create<GenerationStore>((set, get) => ({
  activeJobs: new Map(),
  viewingJobId: null,
  leftPanel: 'gallery',
  restoredParams: null,
  restoringFromUrl: false,

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

    // Write generation hash — import writeHash lazily to avoid circular dep at module level
    const { writeHash } = await import('@/store/effectsStore')
    writeHash(`generations/${response.job_id}`)

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
    // Write null hash — import lazily to avoid circular dep
    import('@/store/effectsStore').then(({ writeHash }) => writeHash(null))
    set({ viewingJobId: null, leftPanel: 'gallery' })
  },

  activeCount: () => {
    let count = 0
    for (const job of get().activeJobs.values()) {
      if (job.status === 'processing') count++
    }
    return count
  },

  restoreFromUrl: async (id: string) => {
    set({ restoringFromUrl: true })
    try {
      const record = await api.getGeneration(id)

      // Parse manifest_json — structure is { effect, request, prompt }
      const manifestData = (typeof record.manifest_json === 'string'
        ? JSON.parse(record.manifest_json)
        : record.manifest_json) as {
        effect?: { id?: string }
        request?: {
          effect_id?: string
          model_id?: string
          inputs?: Record<string, string>
          output?: { aspect_ratio: string; duration: number }
          user_params?: Record<string, unknown>
        }
        prompt?: string
      } | null
      const reqData = manifestData?.request ?? null

      // Create an ActiveJob from the record
      const job: ActiveJob = {
        jobId: record.id,
        effectName: record.effect_name,
        status: record.status,
        progress: record.progress,
        message: record.progress_msg,
        videoUrl: record.video_url,
        error: record.error,
      }

      const jobs = new Map(get().activeJobs)
      jobs.set(record.id, job)

      // Determine leftPanel based on status
      let leftPanel: LeftPanel = 'progress'
      if (record.status === 'completed') leftPanel = 'result'

      // Build restoredParams from request data
      const restoredParams: RestoredParams | null = reqData
        ? {
            modelId: reqData.model_id ?? '',
            inputs: reqData.inputs ?? {},
            output: reqData.output ?? { aspect_ratio: '9:16', duration: 5 },
            userParams: reqData.user_params,
          }
        : null

      set({
        activeJobs: jobs,
        viewingJobId: record.id,
        leftPanel,
        restoredParams,
        restoringFromUrl: false,
      })

      // Select the effect (without writing hash — the hash is already set)
      const { useEffectsStore } = await import('@/store/effectsStore')
      const effectId = record.effect_id ?? reqData?.effect_id
      if (effectId) {
        useEffectsStore.getState().selectEffect(effectId, true)
      }
    } catch (e) {
      console.error('Failed to restore generation from URL:', e)
      set({ restoringFromUrl: false, viewingJobId: null, leftPanel: 'gallery', restoredParams: null })
      // Navigate back to gallery
      const { writeHash } = await import('@/store/effectsStore')
      writeHash(null)
    }
  },
}))
