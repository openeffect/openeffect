import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/utils/api', () => ({
  api: {
    getRuns: vi.fn(),
  },
}))

import { useStore } from '../../src/store'
import {
  trackJob,
  untrackJob,
  bootstrap,
  __resetForTests,
} from '../../src/store/sseManager'
import { api } from '../../src/utils/api'

const _api = api as unknown as {
  getRuns: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  __resetForTests()
  vi.clearAllMocks()
  useStore.setState((s) => {
    s.run.jobs = new Map()
  })
})

describe('sseManager — tracking lifecycle', () => {
  // EventSource is undefined in the JSDOM/Node test environment (the module
  // explicitly handles this case — `tracking still works, no wire opens`).
  // These tests pin that contract so adding/removing jobs doesn't crash
  // when no SSE transport is available.

  it('trackJob is idempotent for the same job id', () => {
    expect(() => {
      trackJob('job-1')
      trackJob('job-1')  // duplicate — must not double-add or throw
    }).not.toThrow()
  })

  it('untrackJob is idempotent for unknown ids', () => {
    expect(() => {
      untrackJob('never-tracked')
    }).not.toThrow()
  })

  it('track then untrack settles cleanly', () => {
    expect(() => {
      trackJob('job-1')
      trackJob('job-2')
      untrackJob('job-1')
      untrackJob('job-2')
      // Re-tracking after the set emptied must work too.
      trackJob('job-3')
      untrackJob('job-3')
    }).not.toThrow()
  })
})

describe('sseManager.bootstrap', () => {
  it('seeds the store with each processing run from the server', async () => {
    _api.getRuns.mockResolvedValueOnce({
      total: 2,
      active_count: 2,
      runs: [
        {
          id: 'run-A', model_id: 'wan-2.7', status: 'processing',
          kind: 'effect', effect_id: 'e1', effect_name: 'Foo',
          progress: 30, progress_msg: 'Generating',
          output: null, input_files: {}, inputs: null, error: null,
          created_at: '', updated_at: '', duration_ms: null,
        },
        {
          id: 'run-B', model_id: 'kling-3.0', status: 'processing',
          kind: 'playground', effect_id: null, effect_name: null,
          progress: 50, progress_msg: null,
          output: null, input_files: {}, inputs: null, error: null,
          created_at: '', updated_at: '', duration_ms: null,
        },
      ],
    })

    await bootstrap()

    const jobs = useStore.getState().run.jobs
    expect(jobs.size).toBe(2)

    const a = jobs.get('run-A')!
    expect(a.jobId).toBe('run-A')
    expect(a.effectName).toBe('Foo')
    expect(a.status).toBe('processing')
    expect(a.progress).toBe(30)
    expect(a.message).toBe('Generating')

    // Playground runs (no effect_name) should default to 'Playground'.
    const b = jobs.get('run-B')!
    expect(b.effectName).toBe('Playground')
    expect(b.progress).toBe(50)
    // Null progress_msg comes through as null, not the string 'null'.
    expect(b.message).toBeNull()
  })

  it('does not overwrite a job already present in the store', async () => {
    // The store already has run-A — bootstrap shouldn't clobber it
    // (the live SSE-driven entry is more current than what we'd seed).
    useStore.setState((s) => {
      s.run.jobs = new Map([
        ['run-A', {
          jobId: 'run-A',
          effectName: 'LiveName',
          status: 'processing',
          progress: 99,
          message: 'Almost done',
          videoUrl: null,
          error: null,
        }],
      ])
    })
    _api.getRuns.mockResolvedValueOnce({
      total: 1, active_count: 1,
      runs: [{
        id: 'run-A', model_id: 'wan-2.7', status: 'processing',
        kind: 'effect', effect_id: 'e1', effect_name: 'StaleName',
        progress: 10, progress_msg: 'Old message',
        output: null, input_files: {}, inputs: null, error: null,
        created_at: '', updated_at: '', duration_ms: null,
      }],
    })

    await bootstrap()

    const a = useStore.getState().run.jobs.get('run-A')!
    expect(a.effectName).toBe('LiveName')
    expect(a.progress).toBe(99)
  })

  it('is a no-op when there are no processing runs', async () => {
    _api.getRuns.mockResolvedValueOnce({
      total: 0, active_count: 0, runs: [],
    })

    await bootstrap()

    expect(useStore.getState().run.jobs.size).toBe(0)
  })

  it('swallows API errors so a transient failure does not break startup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    _api.getRuns.mockRejectedValueOnce(new Error('network blip'))

    // Must not throw — the boot path is fire-and-forget.
    await expect(bootstrap()).resolves.toBeUndefined()
    // Logged for observability, but no rethrow.
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })
})
