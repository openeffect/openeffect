import { create } from 'zustand'
import type { GenerationRequest } from '@/types/api'
import { api } from '@/lib/api'
import { writeHash } from '@/lib/router'
import { useEditorStore } from '@/store/editorStore'

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
  output: Record<string, string | number>
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
  restoreFromUrl: (id: string) => Promise<string | null>
}

function updateJob(jobs: Map<string, ActiveJob>, jobId: string, patch: Partial<ActiveJob>): Map<string, ActiveJob> {
  const job = jobs.get(jobId)
  if (!job) return jobs
  const next = new Map(jobs)
  next.set(jobId, { ...job, ...patch })
  return next
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
    writeHash(`generations/${response.job_id}`)
    return response.job_id
  },

  updateJobProgress: (jobId, progress, message) => {
    set({ activeJobs: updateJob(get().activeJobs, jobId, { progress, message }) })
  },

  completeJob: (jobId, videoUrl) => {
    const activeJobs = updateJob(get().activeJobs, jobId, { status: 'completed', progress: 100, videoUrl })
    set({
      activeJobs,
      ...(get().viewingJobId === jobId ? { leftPanel: 'result' as const } : {}),
    })
  },

  failJob: (jobId, error) => {
    set({ activeJobs: updateJob(get().activeJobs, jobId, { status: 'failed', error }) })
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
    const { isEditorOpen, editingEffectId } = useEditorStore.getState()
    if (isEditorOpen && editingEffectId) {
      writeHash(`effects/${editingEffectId}/edit`)
    } else {
      writeHash(null)
    }
    set({ viewingJobId: null, leftPanel: 'gallery', restoredParams: null })
  },

  restoreFromUrl: async (id) => {
    set({ restoringFromUrl: true })
    try {
      const record = await api.getGeneration(id)

      const manifestData = (typeof record.manifest_yaml === 'string'
        ? JSON.parse(record.manifest_yaml)
        : record.manifest_yaml) as {
        request?: {
          effect_id?: string
          model_id?: string
          inputs?: Record<string, string>
          output?: Record<string, string | number>
          user_params?: Record<string, unknown>
        }
      } | null

      const reqData = manifestData?.request ?? null

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

      set({
        activeJobs: jobs,
        viewingJobId: record.id,
        leftPanel: record.status === 'completed' ? 'result' : 'progress',
        restoredParams: reqData
          ? {
              modelId: reqData.model_id ?? '',
              inputs: reqData.inputs ?? {},
              output: reqData.output ?? {},
              userParams: reqData.user_params,
            }
          : null,
        restoringFromUrl: false,
      })

      return record.effect_id ?? reqData?.effect_id ?? null
    } catch (e) {
      console.error('Failed to restore generation from URL:', e)
      set({ restoringFromUrl: false, viewingJobId: null, leftPanel: 'gallery', restoredParams: null })
      writeHash(null)
      return null
    }
  },
}))

// ─── Selectors ───

export function getActiveJobCount(): number {
  let count = 0
  for (const job of useGenerationStore.getState().activeJobs.values()) {
    if (job.status === 'processing') count++
  }
  return count
}

export function useActiveJobCount(): number {
  const activeJobs = useGenerationStore((s) => s.activeJobs)
  let count = 0
  for (const job of activeJobs.values()) {
    if (job.status === 'processing') count++
  }
  return count
}
