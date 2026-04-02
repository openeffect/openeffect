import type { EffectsSlice } from '../types'

export const initialEffectsState: EffectsSlice = {
  items: [],
  status: 'idle',
  error: null,
  selectedId: null,
  searchQuery: '',
  activeSource: 'all',
  activeCategory: 'all',
}
