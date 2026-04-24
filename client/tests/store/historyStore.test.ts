import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/api', () => ({
  api: {
    getRuns: vi.fn().mockResolvedValue({
      items: [
        { id: 'run-1', effect_id: 'eff-1', effect_name: 'Effect 1', status: 'completed', progress: 100, video_url: '/v.mp4', inputs: null, error: null, created_at: '2025-01-01', updated_at: '2025-01-01', duration_ms: 5000, progress_msg: null },
        { id: 'run-2', effect_id: 'eff-1', effect_name: 'Effect 1', status: 'failed', progress: 0, video_url: null, inputs: null, error: 'timeout', created_at: '2025-01-02', updated_at: '2025-01-02', duration_ms: null, progress_msg: null },
      ],
      total: 2,
      active_count: 0,
    }),
    getRun: vi.fn().mockResolvedValue({
      id: 'run-1', effect_id: 'eff-1', effect_name: 'Effect 1', model_id: 'wan-2.7',
      status: 'completed', progress: 100, video_url: '/v.mp4', inputs: '{"inputs":{"prompt":"test"}}',
      error: null, created_at: '2025-01-01', updated_at: '2025-01-01', duration_ms: 5000, progress_msg: null,
    }),
    deleteRun: vi.fn().mockResolvedValue({ ok: true }),
    uninstallEffect: vi.fn().mockResolvedValue({ ok: true }),
    getEffects: vi.fn().mockResolvedValue([]),
    toggleFavorite: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

vi.mock('../../src/utils/router', () => ({
  navigate: vi.fn(),
  parseRoute: vi.fn().mockReturnValue({ page: 'gallery' }),
  initRouteListener: vi.fn(),
}))

import { useStore } from '../../src/store'
import type { EffectManifest, RunRecord } from '../../src/types/api'
import { api } from '../../src/utils/api'
import {
  loadHistory,
  deleteHistoryItem,
  openHistory,
  closeHistory,
  loadEffectHistory,
  loadPlaygroundHistory,
  clearEffectHistory,
  deleteRunFromHistory,
} from '../../src/store/actions/historyActions'
import { deleteEffect } from '../../src/store/actions/effectsActions'

const getRunsMock = vi.mocked(api.getRuns)

beforeEach(() => {
  getRunsMock.mockClear()
  useStore.setState((s) => {
    s.history.items = new Map()
    s.history.total = 0
    s.history.activeCount = 0
    s.history.status = 'idle'
    s.history.isOpen = false
    s.history.effectItems = new Map()
    s.history.effectTotal = 0
    s.history.effectStatus = 'idle'
    s.history.effectId = null
    s.history.playgroundItems = new Map()
    s.history.playgroundTotal = 0
    s.history.playgroundStatus = 'idle'
    s.history.playgroundLoaded = false
    s.run.viewingJobId = null
    s.run.viewingRunRecord = null
  })
})

describe('historyStore', () => {
  describe('loadHistory', () => {
    it('loads global history items', async () => {
      await loadHistory()
      const s = useStore.getState()
      expect(s.history.items.size).toBe(2)
      expect(s.history.total).toBe(2)
      expect(s.history.status).toBe('succeeded')
    })

    it('appends items when offset > 0', async () => {
      // Pre-fill with existing items
      useStore.setState((s) => {
        s.history.items = new Map([['existing', { id: 'existing' } as unknown as RunRecord]])
        s.history.total = 3
      })

      await loadHistory(1)
      const s = useStore.getState()
      // 1 existing + 2 new = 3
      expect(s.history.items.size).toBe(3)
    })
  })

  describe('deleteHistoryItem', () => {
    it('removes item from history', async () => {
      await loadHistory()
      expect(useStore.getState().history.items.size).toBe(2)

      await deleteHistoryItem('run-1')
      const s = useStore.getState()
      expect(s.history.items.size).toBe(1)
      expect(s.history.items.has('run-1')).toBe(false)
      expect(s.history.items.has('run-2')).toBe(true)
    })
  })

  describe('openHistory / closeHistory', () => {
    it('sets isOpen to true on open', () => {
      openHistory()
      expect(useStore.getState().history.isOpen).toBe(true)
    })

    it('sets isOpen to false on close', () => {
      openHistory()
      closeHistory()
      expect(useStore.getState().history.isOpen).toBe(false)
    })
  })

  describe('loadEffectHistory', () => {
    it('loads per-effect history', async () => {
      await loadEffectHistory('eff-1')
      const s = useStore.getState()
      expect(s.history.effectItems.size).toBe(2)
      expect(s.history.effectTotal).toBe(2)
      expect(s.history.effectId).toBe('eff-1')
      expect(s.history.effectStatus).toBe('succeeded')
    })

    it('replaces items on offset 0', async () => {
      useStore.setState((s) => {
        s.history.effectItems = new Map([['old', { id: 'old' } as unknown as RunRecord]])
      })

      await loadEffectHistory('eff-1', 0)
      const s = useStore.getState()
      expect(s.history.effectItems.size).toBe(2)
      expect(s.history.effectItems.has('old')).toBe(false)
      expect(s.history.effectItems.has('run-1')).toBe(true)
    })

    it('appends items on offset > 0', async () => {
      useStore.setState((s) => {
        s.history.effectItems = new Map([['existing', { id: 'existing' } as unknown as RunRecord]])
        s.history.effectTotal = 3
      })

      await loadEffectHistory('eff-1', 1)
      expect(useStore.getState().history.effectItems.size).toBe(3)
    })
  })

  describe('clearEffectHistory', () => {
    it('clears per-effect history state', async () => {
      await loadEffectHistory('eff-1')
      expect(useStore.getState().history.effectItems.size).toBe(2)

      clearEffectHistory()
      const s = useStore.getState()
      expect(s.history.effectItems.size).toBe(0)
      expect(s.history.effectTotal).toBe(0)
      expect(s.history.effectId).toBeNull()
      expect(s.history.effectStatus).toBe('idle')
    })
  })

  describe('caching', () => {
    it('loadHistory skips the fetch when the cache is warm', async () => {
      await loadHistory()
      expect(getRunsMock).toHaveBeenCalledTimes(1)

      await loadHistory()
      expect(getRunsMock).toHaveBeenCalledTimes(1)
    })

    it('loadHistory(offset=0, force=true) bypasses the cache', async () => {
      await loadHistory()
      expect(getRunsMock).toHaveBeenCalledTimes(1)

      await loadHistory(0, true)
      expect(getRunsMock).toHaveBeenCalledTimes(2)
    })

    it('loadHistory pagination always fetches', async () => {
      await loadHistory()
      expect(getRunsMock).toHaveBeenCalledTimes(1)

      await loadHistory(50)
      expect(getRunsMock).toHaveBeenCalledTimes(2)
    })

    it('loadEffectHistory refetches when effectId changes', async () => {
      await loadEffectHistory('eff-1')
      expect(getRunsMock).toHaveBeenCalledTimes(1)

      // Same id with warm cache → skipped
      await loadEffectHistory('eff-1')
      expect(getRunsMock).toHaveBeenCalledTimes(1)

      // Different id → fetch
      await loadEffectHistory('eff-2')
      expect(getRunsMock).toHaveBeenCalledTimes(2)
    })

    it('loadEffectHistory(force=true) bypasses the cache', async () => {
      await loadEffectHistory('eff-1')
      expect(getRunsMock).toHaveBeenCalledTimes(1)

      await loadEffectHistory('eff-1', 0, true)
      expect(getRunsMock).toHaveBeenCalledTimes(2)
    })

    it('loadPlaygroundHistory skips the fetch when the cache is warm', async () => {
      await loadPlaygroundHistory()
      expect(getRunsMock).toHaveBeenCalledTimes(1)

      await loadPlaygroundHistory()
      expect(getRunsMock).toHaveBeenCalledTimes(1)
    })

    it('deleteRunFromHistory does not trigger a follow-up refetch', async () => {
      await loadEffectHistory('eff-1')
      expect(getRunsMock).toHaveBeenCalledTimes(1)

      await deleteRunFromHistory('run-1', 'eff-1')
      // Local delete only — no network call
      expect(getRunsMock).toHaveBeenCalledTimes(1)
      expect(useStore.getState().history.effectItems.has('run-1')).toBe(false)
    })

    it('deleteEffect invalidates the history caches', async () => {
      // The effect must be in the store's items Map before deleteEffect can
      // find its UUID by (namespace, slug). Seed both that and the per-effect
      // history cache keyed to the same UUID.
      const effectId = 'uuid-to-remove'
      useStore.setState((s) => {
        const effect: EffectManifest = {
          id: effectId,
          namespace: 'openeffect',
          slug: 'to-remove',
          full_id: 'openeffect/to-remove',
          name: 'Doomed Effect',
          description: '',
          version: '1.0.0',
          author: 'test',
          category: 'transform',
          tags: [],
          assets: {},
          source: 'local',
          compatible_models: [],
          is_favorite: false,
          inputs: {},
          generation: {
            prompt: '',
            negative_prompt: '',
            models: [],
            default_model: '',
            params: {},
            model_overrides: {},
            reverse: false,
          },
        }
        s.effects.items.set(effect.id, effect)
      })
      await loadHistory()
      await loadEffectHistory(effectId)

      expect(useStore.getState().history.status).toBe('succeeded')
      expect(useStore.getState().history.effectStatus).toBe('succeeded')

      await deleteEffect('openeffect', 'to-remove')

      const s = useStore.getState()
      expect(s.effects.items.has(effectId)).toBe(false)
      expect(s.history.status).toBe('idle')
      expect(s.history.effectStatus).toBe('idle')
      expect(s.history.effectId).toBeNull()
      expect(s.history.effectItems.size).toBe(0)
    })
  })
})
