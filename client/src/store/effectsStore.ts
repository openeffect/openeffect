import { create } from 'zustand'
import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'

// ─── Hash helpers ───

function readHash(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.slice(1)
  return hash || null
}

function writeHash(id: string | null) {
  if (typeof window === 'undefined') return
  const current = readHash()
  if (id === current) return
  if (id) {
    window.history.pushState(null, '', `#${id}`)
  } else {
    window.history.pushState(null, '', window.location.pathname)
  }
}

// ─── Store ───

interface EffectsStore {
  effects: EffectManifest[]
  status: 'idle' | 'loading' | 'succeeded' | 'failed'
  error: string | null
  selectedEffectId: string | null
  searchQuery: string
  activeCategory: string

  loadEffects: () => Promise<void>
  selectEffect: (id: string | null) => void
  setSearchQuery: (q: string) => void
  setActiveCategory: (cat: string) => void
}

function isValidEffectId(effects: EffectManifest[], id: string): boolean {
  return effects.some((e) => `${e.effect_type.replace(/_/g, '-')}/${e.id}` === id)
}

export const useEffectsStore = create<EffectsStore>((set) => ({
  effects: [],
  status: 'idle',
  error: null,
  selectedEffectId: null,
  searchQuery: '',
  activeCategory: 'all',

  loadEffects: async () => {
    set({ status: 'loading', error: null })
    try {
      const effects = await api.getEffects()

      // After loading, check if URL hash points to a valid effect
      const hashId = readHash()
      const selectedEffectId = hashId && isValidEffectId(effects, hashId) ? hashId : null

      set({ effects, status: 'succeeded', selectedEffectId })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load effects', status: 'failed' })
    }
  },

  selectEffect: (id) => {
    writeHash(id)
    set({ selectedEffectId: id })
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
  setActiveCategory: (cat) => set({ activeCategory: cat }),
}))

// Listen for browser back/forward
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const { effects, status } = useEffectsStore.getState()
    if (status !== 'succeeded') return

    const hashId = readHash()
    const selectedEffectId = hashId && isValidEffectId(effects, hashId) ? hashId : null
    useEffectsStore.setState({ selectedEffectId })
  })
}

// ─── Selectors ───

export function useFilteredEffects(): EffectManifest[] {
  const effects = useEffectsStore((s) => s.effects)
  const searchQuery = useEffectsStore((s) => s.searchQuery)
  const activeCategory = useEffectsStore((s) => s.activeCategory)

  return effects.filter((e) => {
    if (activeCategory !== 'all') {
      const typeCategory = e.effect_type.replace(/_/g, '-')
      if (typeCategory !== activeCategory && e.category !== activeCategory) {
        return false
      }
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
      )
    }
    return true
  })
}

export function useSelectedEffect(): EffectManifest | null {
  const effects = useEffectsStore((s) => s.effects)
  const selectedId = useEffectsStore((s) => s.selectedEffectId)
  if (!selectedId) return null
  return effects.find((e) => {
    const fullId = `${e.effect_type.replace(/_/g, '-')}/${e.id}`
    return fullId === selectedId
  }) ?? null
}
