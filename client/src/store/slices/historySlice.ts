import type { RunRecord } from '@/types/api'
import type { HistorySlice } from '../types'

export const initialHistoryState: HistorySlice = {
  items: new Map<string, RunRecord>(),
  total: 0,
  activeCount: 0,
  status: 'idle',
  isOpen: false,

  effectItems: new Map<string, RunRecord>(),
  effectTotal: 0,
  effectStatus: 'idle',
  effectId: null,

  playgroundItems: new Map<string, RunRecord>(),
  playgroundTotal: 0,
  playgroundStatus: 'idle',
  playgroundLoaded: false,
}
