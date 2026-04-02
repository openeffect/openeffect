import type { HistorySlice } from '../types'

export const initialHistoryState: HistorySlice = {
  items: [],
  total: 0,
  activeCount: 0,
  status: 'idle',
  isOpen: false,
}
