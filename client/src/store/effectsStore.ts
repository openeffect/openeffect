import { create } from 'zustand'
import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'
import { parseHash, writeHash, initPopstateListener } from '@/lib/router'
import { useGenerationStore } from '@/store/generationStore'

// ─── Store ───

interface EffectsStore {
  effects: EffectManifest[]
  status: 'idle' | 'loading' | 'succeeded' | 'failed'
  error: string | null
  selectedEffectId: string | null
  searchQuery: string
  activeSource: 'all' | 'official' | 'installed'
  activeCategory: string

  loadEffects: () => Promise<void>
  selectEffect: (id: string | null, skipHash?: boolean) => void
  setSearchQuery: (q: string) => void
  setActiveSource: (source: 'all' | 'official' | 'installed') => void
  setActiveCategory: (cat: string) => void
}

function isValidEffectId(effects: EffectManifest[], id: string): boolean {
  return effects.some((e) => `${e.namespace}/${e.id}` === id)
}

export const useEffectsStore = create<EffectsStore>((set) => ({
  effects: [],
  status: 'idle',
  error: null,
  selectedEffectId: null,
  searchQuery: '',
  activeSource: 'all',
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
        useGenerationStore.getState().restoreFromUrl(parsed.id).then((effectId) => {
          if (effectId) useEffectsStore.getState().selectEffect(effectId, true)
        })
      }

      set({ effects, status: 'succeeded', selectedEffectId })

      // Wire up popstate listener now that effects are loaded
      initPopstateListener(
        (id) => useEffectsStore.setState({ selectedEffectId: id }),
        (id) => {
          useGenerationStore.getState().restoreFromUrl(id).then((effectId) => {
            if (effectId) useEffectsStore.getState().selectEffect(effectId, true)
          })
        },
        () => {
          useGenerationStore.getState().closeJob()
          useEffectsStore.setState({ selectedEffectId: null })
        },
        (id) => isValidEffectId(useEffectsStore.getState().effects, id),
      )
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load effects', status: 'failed' })
    }
  },

  selectEffect: (id, skipHash) => {
    if (!skipHash) {
      writeHash(id ? `effects/${id}` : null)
    }
    if (id === null) {
      useGenerationStore.getState().closeJob()
    }
    set({ selectedEffectId: id })
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
  setActiveSource: (source) => set({ activeSource: source }),
  setActiveCategory: (cat) => set({ activeCategory: cat }),
}))

// ─── Selectors ───

export function useFilteredEffects(): EffectManifest[] {
  const effects = useEffectsStore((s) => s.effects)
  const searchQuery = useEffectsStore((s) => s.searchQuery)
  const activeSource = useEffectsStore((s) => s.activeSource)
  const activeCategory = useEffectsStore((s) => s.activeCategory)

  return effects.filter((e) => {
    if (activeSource === 'official' && e.source !== 'official') return false
    if (activeSource === 'installed' && e.source === 'official') return false
    if (activeCategory !== 'all') {
      if (e.type !== activeCategory && e.category !== activeCategory) {
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
  return effects.find((e) => `${e.namespace}/${e.id}` === selectedId) ?? null
}
