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
      id: 'run-1', effect_id: 'eff-1', effect_name: 'Effect 1', model_id: 'wan-2.2',
      status: 'completed', progress: 100, video_url: '/v.mp4', inputs: '{"inputs":{"prompt":"test"}}',
      error: null, created_at: '2025-01-01', updated_at: '2025-01-01', duration_ms: 5000, progress_msg: null,
    }),
    deleteRun: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

vi.mock('../../src/utils/router', () => ({
  navigate: vi.fn(),
  parseRoute: vi.fn().mockReturnValue({ page: 'gallery' }),
  initRouteListener: vi.fn(),
}))

import { useStore } from '../../src/store'
import {
  loadHistory,
  deleteHistoryItem,
  openHistory,
  closeHistory,
  loadEffectHistory,
  clearEffectHistory,
} from '../../src/store/actions/historyActions'

beforeEach(() => {
  useStore.setState((s) => {
    s.history.items = []
    s.history.total = 0
    s.history.activeCount = 0
    s.history.status = 'idle'
    s.history.isOpen = false
    s.history.effectItems = []
    s.history.effectTotal = 0
    s.history.effectStatus = 'idle'
    s.history.effectId = null
    s.run.viewingJobId = null
    s.run.viewingRunRecord = null
  })
})

describe('historyStore', () => {
  describe('loadHistory', () => {
    it('loads global history items', async () => {
      await loadHistory()
      const s = useStore.getState()
      expect(s.history.items).toHaveLength(2)
      expect(s.history.total).toBe(2)
      expect(s.history.status).toBe('succeeded')
    })

    it('appends items when offset > 0', async () => {
      // Pre-fill with existing items
      useStore.setState((s) => {
        s.history.items = [{ id: 'existing' } as any]
        s.history.total = 3
      })

      await loadHistory(1)
      const s = useStore.getState()
      // 1 existing + 2 new = 3
      expect(s.history.items).toHaveLength(3)
    })
  })

  describe('deleteHistoryItem', () => {
    it('removes item from history', async () => {
      await loadHistory()
      expect(useStore.getState().history.items).toHaveLength(2)

      await deleteHistoryItem('run-1')
      const s = useStore.getState()
      expect(s.history.items).toHaveLength(1)
      expect(s.history.items[0].id).toBe('run-2')
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
      expect(s.history.effectItems).toHaveLength(2)
      expect(s.history.effectTotal).toBe(2)
      expect(s.history.effectId).toBe('eff-1')
      expect(s.history.effectStatus).toBe('succeeded')
    })

    it('replaces items on offset 0', async () => {
      useStore.setState((s) => {
        s.history.effectItems = [{ id: 'old' } as any]
      })

      await loadEffectHistory('eff-1', 0)
      expect(useStore.getState().history.effectItems).toHaveLength(2)
      expect(useStore.getState().history.effectItems[0].id).toBe('run-1')
    })

    it('appends items on offset > 0', async () => {
      useStore.setState((s) => {
        s.history.effectItems = [{ id: 'existing' } as any]
        s.history.effectTotal = 3
      })

      await loadEffectHistory('eff-1', 1)
      expect(useStore.getState().history.effectItems).toHaveLength(3)
    })
  })

  describe('clearEffectHistory', () => {
    it('clears per-effect history state', async () => {
      await loadEffectHistory('eff-1')
      expect(useStore.getState().history.effectItems).toHaveLength(2)

      clearEffectHistory()
      const s = useStore.getState()
      expect(s.history.effectItems).toHaveLength(0)
      expect(s.history.effectTotal).toBe(0)
      expect(s.history.effectId).toBeNull()
      expect(s.history.effectStatus).toBe('idle')
    })
  })
})
