import type { EffectManifest } from '@/types/api'
import type { EffectsSlice } from '../types'

export const initialEffectsState: EffectsSlice = {
  items: new Map<string, EffectManifest>(),
  status: 'idle',
  error: null,
  selectedId: null,
  searchQuery: '',
  activeSource: 'all',
  activeCategory: 'all',
  rightTab: 'form',
}
