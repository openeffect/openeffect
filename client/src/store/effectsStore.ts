import { create } from 'zustand'
import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'
import { useGenerationStore } from '@/store/generationStore'

// ─── Hash helpers ───

export function parseHash(raw?: string): { mode: 'effect'; id: string } | { mode: 'generation'; id: string } | null {
  const hash = raw ?? (typeof window !== 'undefined' ? window.location.hash.slice(1) : '')
  if (!hash) return null
  if (hash.startsWith('effects/')) return { mode: 'effect', id: hash.slice(8) }
  if (hash.startsWith('generations/')) return { mode: 'generation', id: hash.slice(12) }
  return null
}

export function writeHash(path: string | null) {
  if (typeof window === 'undefined') return
  const current = window.location.hash.slice(1)
  if (path === current) return
  if (path) {
    window.history.pushState(null, '', `#${path}`)
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
  selectEffect: (id: string | null, skipHash?: boolean) => void
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

      // After loading, check if URL hash points to a valid effect or generation
      const parsed = parseHash()
      let selectedEffectId: string | null = null

      if (parsed?.mode === 'effect' && isValidEffectId(effects, parsed.id)) {
        selectedEffectId = parsed.id
      } else if (parsed?.mode === 'generation') {
        // Restore generation from URL — delegate to generationStore
        const { restoreFromUrl } = useGenerationStore.getState()
        restoreFromUrl(parsed.id)
      }

      set({ effects, status: 'succeeded', selectedEffectId })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load effects', status: 'failed' })
    }
  },

  selectEffect: (id, skipHash) => {
    if (!skipHash) {
      writeHash(id ? `effects/${id}` : null)
    }
    if (id === null) {
      // Clear generation state when deselecting
      const genStore = useGenerationStore.getState()
      genStore.closeJob()
      useGenerationStore.setState({ restoredParams: null })
    }
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

    const parsed = parseHash()
    if (parsed?.mode === 'effect') {
      const selectedEffectId = isValidEffectId(effects, parsed.id) ? parsed.id : null
      useEffectsStore.setState({ selectedEffectId })
    } else if (parsed?.mode === 'generation') {
      const { restoreFromUrl } = useGenerationStore.getState()
      restoreFromUrl(parsed.id)
    } else {
      // No hash — clear selection and generation state
      const genStore = useGenerationStore.getState()
      genStore.closeJob()
      useGenerationStore.setState({ restoredParams: null })
      useEffectsStore.setState({ selectedEffectId: null })
    }
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
