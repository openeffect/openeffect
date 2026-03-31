import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GenerationRequest } from '../../src/types/api'

vi.mock('../../src/lib/api', () => ({
  api: {
    generate: vi.fn().mockResolvedValue({ job_id: 'test-job-123', status: 'queued' }),
  },
}))

// Import store after mock is set up
import { useGenerationStore, getActiveJobCount } from '../../src/store/generationStore'

const mockRequest: GenerationRequest = {
  effect_id: 'single-image/zoom-from-space',
  model_id: 'wan-2.2',
  provider_id: 'fal',
  inputs: { image: 'ref-abc-123' },
  output: { aspect_ratio: '9:16', duration: 5 },
}

beforeEach(() => {
  useGenerationStore.setState({
    activeJobs: new Map(),
    viewingJobId: null,
    leftPanel: 'gallery',
  })
})

describe('generationStore', () => {
  describe('startGeneration', () => {
    it('adds a job to activeJobs with status "processing"', async () => {
      const jobId = await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')

      expect(jobId).toBe('test-job-123')

      const job = useGenerationStore.getState().activeJobs.get('test-job-123')
      expect(job).toBeDefined()
      expect(job!.status).toBe('processing')
      expect(job!.effectName).toBe('Zoom From Space')
      expect(job!.progress).toBe(0)
      expect(job!.message).toBe('Starting...')
      expect(job!.videoUrl).toBeNull()
      expect(job!.error).toBeNull()
    })

    it('sets viewingJobId and leftPanel to "progress"', async () => {
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')

      const state = useGenerationStore.getState()
      expect(state.viewingJobId).toBe('test-job-123')
      expect(state.leftPanel).toBe('progress')
    })
  })

  describe('updateJobProgress', () => {
    it('updates progress and message on an existing job', async () => {
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')

      useGenerationStore.getState().updateJobProgress('test-job-123', 42, 'Generating frames...')

      const job = useGenerationStore.getState().activeJobs.get('test-job-123')
      expect(job).toBeDefined()
      expect(job!.progress).toBe(42)
      expect(job!.message).toBe('Generating frames...')
      expect(job!.status).toBe('processing')
    })

    it('does nothing if jobId does not exist', () => {
      useGenerationStore.getState().updateJobProgress('nonexistent', 50, 'hello')

      expect(useGenerationStore.getState().activeJobs.size).toBe(0)
    })
  })

  describe('completeJob', () => {
    it('sets status to "completed", videoUrl, and leftPanel to "result"', async () => {
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')
      // viewingJobId is already 'test-job-123' after startGeneration

      useGenerationStore.getState().completeJob('test-job-123', '/api/assets/output.mp4')

      const job = useGenerationStore.getState().activeJobs.get('test-job-123')
      expect(job).toBeDefined()
      expect(job!.status).toBe('completed')
      expect(job!.progress).toBe(100)
      expect(job!.videoUrl).toBe('/api/assets/output.mp4')
      expect(useGenerationStore.getState().leftPanel).toBe('result')
    })

    it('does not change leftPanel if a different job is being viewed', async () => {
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')

      // Simulate viewing a different job
      useGenerationStore.setState({ viewingJobId: 'other-job' })

      useGenerationStore.getState().completeJob('test-job-123', '/api/assets/output.mp4')

      const job = useGenerationStore.getState().activeJobs.get('test-job-123')
      expect(job!.status).toBe('completed')
      // leftPanel should remain 'progress' (set by startGeneration), not switch to 'result'
      expect(useGenerationStore.getState().leftPanel).toBe('progress')
    })
  })

  describe('failJob', () => {
    it('sets status to "failed" and error message', async () => {
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')

      useGenerationStore.getState().failJob('test-job-123', 'GPU out of memory')

      const job = useGenerationStore.getState().activeJobs.get('test-job-123')
      expect(job).toBeDefined()
      expect(job!.status).toBe('failed')
      expect(job!.error).toBe('GPU out of memory')
    })

    it('does nothing if jobId does not exist', () => {
      useGenerationStore.getState().failJob('nonexistent', 'error')
      expect(useGenerationStore.getState().activeJobs.size).toBe(0)
    })
  })

  describe('openJob', () => {
    it('sets leftPanel to "progress" for a processing job', async () => {
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')

      // Reset leftPanel so we can verify openJob sets it
      useGenerationStore.setState({ viewingJobId: null, leftPanel: 'gallery' })

      useGenerationStore.getState().openJob('test-job-123')

      expect(useGenerationStore.getState().viewingJobId).toBe('test-job-123')
      expect(useGenerationStore.getState().leftPanel).toBe('progress')
    })

    it('sets leftPanel to "result" for a completed job', async () => {
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')
      useGenerationStore.getState().completeJob('test-job-123', '/api/assets/output.mp4')

      // Reset so we can verify openJob
      useGenerationStore.setState({ viewingJobId: null, leftPanel: 'gallery' })

      useGenerationStore.getState().openJob('test-job-123')

      expect(useGenerationStore.getState().viewingJobId).toBe('test-job-123')
      expect(useGenerationStore.getState().leftPanel).toBe('result')
    })

    it('does nothing if jobId does not exist', () => {
      useGenerationStore.getState().openJob('nonexistent')

      expect(useGenerationStore.getState().viewingJobId).toBeNull()
      expect(useGenerationStore.getState().leftPanel).toBe('gallery')
    })
  })

  describe('closeJob', () => {
    it('sets viewingJobId to null and leftPanel to "gallery"', async () => {
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')

      useGenerationStore.getState().closeJob()

      expect(useGenerationStore.getState().viewingJobId).toBeNull()
      expect(useGenerationStore.getState().leftPanel).toBe('gallery')
    })
  })

  describe('activeCount', () => {
    it('returns count of processing jobs only', async () => {
      // Start with no jobs
      expect(getActiveJobCount()).toBe(0)

      // Add a processing job
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')
      expect(getActiveJobCount()).toBe(1)

      // Complete it - should no longer count
      useGenerationStore.getState().completeJob('test-job-123', '/api/assets/output.mp4')
      expect(getActiveJobCount()).toBe(0)
    })

    it('does not count failed jobs', async () => {
      await useGenerationStore.getState().startGeneration(mockRequest, 'Zoom From Space')
      useGenerationStore.getState().failJob('test-job-123', 'error')
      expect(getActiveJobCount()).toBe(0)
    })

    it('counts multiple processing jobs', async () => {
      // Need distinct job IDs, so re-mock for second call
      const { api } = await import('../../src/lib/api')
      const generateMock = vi.mocked(api.generate)

      generateMock.mockResolvedValueOnce({ job_id: 'job-1', status: 'queued' })
      await useGenerationStore.getState().startGeneration(mockRequest, 'Effect A')

      generateMock.mockResolvedValueOnce({ job_id: 'job-2', status: 'queued' })
      await useGenerationStore.getState().startGeneration(mockRequest, 'Effect B')

      expect(getActiveJobCount()).toBe(2)

      // Complete one
      useGenerationStore.getState().completeJob('job-1', '/api/assets/a.mp4')
      expect(getActiveJobCount()).toBe(1)

      // Fail the other
      useGenerationStore.getState().failJob('job-2', 'timeout')
      expect(getActiveJobCount()).toBe(0)
    })
  })
})
