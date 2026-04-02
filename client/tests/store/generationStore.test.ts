import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EffectManifest } from '../../src/types/api'

vi.mock('../../src/utils/api', () => ({
  api: {
    generate: vi.fn().mockResolvedValue({ job_id: 'test-job-123', status: 'queued' }),
    upload: vi.fn().mockResolvedValue({ ref_id: 'uploaded-ref' }),
  },
}))

vi.mock('../../src/utils/router', () => ({
  writeHash: vi.fn(),
  parseHash: vi.fn().mockReturnValue(null),
  initPopstateListener: vi.fn(),
}))

// Import store + actions after mocks
import { useStore } from '../../src/store'
import { selectActiveJobCount } from '../../src/store/selectors/generationSelectors'
import {
  startGeneration,
  updateJobProgress,
  completeJob,
  failJob,
  openJob,
  closeJob,
} from '../../src/store/actions/generationActions'

const mockManifest: EffectManifest = {
  id: 'zoom-from-space',
  namespace: 'single-image',
  name: 'Zoom From Space',
  description: 'test',
  version: '1.0.0',
  author: 'test',
  type: 'single-image',
  category: 'cinematic',
  source: 'official',
  tags: [],
  assets: {},
  inputs: {},
  generation: {
    prompt: 'test',
    negative_prompt: '',
    models: ['wan-2.2'],
    default_model: 'wan-2.2',
    defaults: {},
    model_overrides: {},
  },
}

function getActiveCount(): number {
  return selectActiveJobCount(useStore.getState())
}

beforeEach(() => {
  useStore.setState((s) => {
    s.generation.jobs = new Map()
    s.generation.viewingJobId = null
    s.generation.leftPanel = 'gallery'
    s.generation.restoredParams = null
    s.generation.restoringFromUrl = false
  })
})

describe('generationStore', () => {
  describe('startGeneration', () => {
    it('adds a job to jobs with status "processing"', async () => {
      const jobId = await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', { aspect_ratio: '9:16', duration: 5 }, {})

      expect(jobId).toBe('test-job-123')

      const job = useStore.getState().generation.jobs.get('test-job-123')
      expect(job).toBeDefined()
      expect(job!.status).toBe('processing')
      expect(job!.effectName).toBe('Zoom From Space')
      expect(job!.progress).toBe(0)
      expect(job!.message).toBe('Starting...')
      expect(job!.videoUrl).toBeNull()
      expect(job!.error).toBeNull()
    })

    it('sets viewingJobId and leftPanel to "progress"', async () => {
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})

      const state = useStore.getState()
      expect(state.generation.viewingJobId).toBe('test-job-123')
      expect(state.generation.leftPanel).toBe('progress')
    })
  })

  describe('updateJobProgress', () => {
    it('updates progress and message on an existing job', async () => {
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})

      updateJobProgress('test-job-123', 42, 'Generating frames...')

      const job = useStore.getState().generation.jobs.get('test-job-123')
      expect(job).toBeDefined()
      expect(job!.progress).toBe(42)
      expect(job!.message).toBe('Generating frames...')
      expect(job!.status).toBe('processing')
    })

    it('does nothing if jobId does not exist', () => {
      updateJobProgress('nonexistent', 50, 'hello')
      expect(useStore.getState().generation.jobs.size).toBe(0)
    })
  })

  describe('completeJob', () => {
    it('sets status to "completed", videoUrl, and leftPanel to "result"', async () => {
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})

      completeJob('test-job-123', '/api/assets/output.mp4')

      const job = useStore.getState().generation.jobs.get('test-job-123')
      expect(job).toBeDefined()
      expect(job!.status).toBe('completed')
      expect(job!.progress).toBe(100)
      expect(job!.videoUrl).toBe('/api/assets/output.mp4')
      expect(useStore.getState().generation.leftPanel).toBe('result')
    })

    it('does not change leftPanel if a different job is being viewed', async () => {
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})

      // Simulate viewing a different job
      useStore.setState((s) => { s.generation.viewingJobId = 'other-job' })

      completeJob('test-job-123', '/api/assets/output.mp4')

      const job = useStore.getState().generation.jobs.get('test-job-123')
      expect(job!.status).toBe('completed')
      // leftPanel should remain 'progress' (set by startGeneration), not switch to 'result'
      expect(useStore.getState().generation.leftPanel).toBe('progress')
    })
  })

  describe('failJob', () => {
    it('sets status to "failed" and error message', async () => {
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})

      failJob('test-job-123', 'GPU out of memory')

      const job = useStore.getState().generation.jobs.get('test-job-123')
      expect(job).toBeDefined()
      expect(job!.status).toBe('failed')
      expect(job!.error).toBe('GPU out of memory')
    })

    it('does nothing if jobId does not exist', () => {
      failJob('nonexistent', 'error')
      expect(useStore.getState().generation.jobs.size).toBe(0)
    })
  })

  describe('openJob', () => {
    it('sets leftPanel to "progress" for a processing job', async () => {
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})

      // Reset leftPanel so we can verify openJob sets it
      useStore.setState((s) => {
        s.generation.viewingJobId = null
        s.generation.leftPanel = 'gallery'
      })

      openJob('test-job-123')

      expect(useStore.getState().generation.viewingJobId).toBe('test-job-123')
      expect(useStore.getState().generation.leftPanel).toBe('progress')
    })

    it('sets leftPanel to "result" for a completed job', async () => {
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})
      completeJob('test-job-123', '/api/assets/output.mp4')

      // Reset so we can verify openJob
      useStore.setState((s) => {
        s.generation.viewingJobId = null
        s.generation.leftPanel = 'gallery'
      })

      openJob('test-job-123')

      expect(useStore.getState().generation.viewingJobId).toBe('test-job-123')
      expect(useStore.getState().generation.leftPanel).toBe('result')
    })

    it('does nothing if jobId does not exist', () => {
      openJob('nonexistent')

      expect(useStore.getState().generation.viewingJobId).toBeNull()
      expect(useStore.getState().generation.leftPanel).toBe('gallery')
    })
  })

  describe('closeJob', () => {
    it('sets viewingJobId to null and leftPanel to "gallery"', async () => {
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})

      closeJob()

      expect(useStore.getState().generation.viewingJobId).toBeNull()
      expect(useStore.getState().generation.leftPanel).toBe('gallery')
    })
  })

  describe('activeCount', () => {
    it('returns count of processing jobs only', async () => {
      expect(getActiveCount()).toBe(0)

      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})
      expect(getActiveCount()).toBe(1)

      completeJob('test-job-123', '/api/assets/output.mp4')
      expect(getActiveCount()).toBe(0)
    })

    it('does not count failed jobs', async () => {
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})
      failJob('test-job-123', 'error')
      expect(getActiveCount()).toBe(0)
    })

    it('counts multiple processing jobs', async () => {
      const { api } = await import('../../src/utils/api')
      const generateMock = vi.mocked(api.generate)

      generateMock.mockResolvedValueOnce({ job_id: 'job-1', status: 'queued' })
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})

      generateMock.mockResolvedValueOnce({ job_id: 'job-2', status: 'queued' })
      await startGeneration(mockManifest, {}, 'wan-2.2', 'fal', {}, {})

      expect(getActiveCount()).toBe(2)

      completeJob('job-1', '/api/assets/a.mp4')
      expect(getActiveCount()).toBe(1)

      failJob('job-2', 'timeout')
      expect(getActiveCount()).toBe(0)
    })
  })
})
