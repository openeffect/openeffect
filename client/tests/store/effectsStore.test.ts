import { describe, it, expect, beforeEach } from 'vitest'
import { useEffectsStore } from '../../src/store/effectsStore'
import type { EffectManifest } from '../../src/types/api'

// --- Mock data ---

const mockEffects: EffectManifest[] = [
  {
    id: 'zoom-from-space',
    name: 'Zoom From Space',
    description: 'A dramatic zoom from outer space down to a portrait',
    version: '1.0.0',
    author: 'openeffect',
    type: 'single-image',
    category: 'cinematic',
    tags: ['zoom', 'space', 'dramatic', 'portrait'],
    assets: {
      
    },
    inputs: {
      image: {
        type: 'image',
        required: true,
        label: 'Photo',
      },
    },
    generation: {
      prompt: 'zoom from space to {image}',
      negative_prompt: 'blurry, low quality',
      models: ['wan-2.2'],
      default_model: 'kling-v3',
      defaults: { guidance_scale: 7.5 },
      model_overrides: {},
    },
  },
  {
    id: 'hug-effect',
    name: 'Warm Hug',
    description: 'Two people share a warm embrace',
    version: '1.0.0',
    author: 'openeffect',
    type: 'image-transition',
    category: 'emotional',
    tags: ['hug', 'embrace', 'love'],
    assets: {
      
      preview: 'preview.mp4',
    },
    inputs: {
      image_a: {
        type: 'image',
        required: true,
        label: 'Person A',
        role: 'start_frame',
      },
      image_b: {
        type: 'image',
        required: true,
        label: 'Person B',
        role: 'end_frame',
      },
    },
    generation: {
      prompt: '{image_a} hugs {image_b}',
      negative_prompt: '',
      models: ['wan-2.2'],
      default_model: 'kling-v3',
      defaults: {},
      model_overrides: {},
    },
  },
  {
    id: 'dance-loop',
    name: 'Dance Loop',
    description: 'A seamless dancing loop animation',
    version: '1.0.0',
    author: 'openeffect',
    type: 'single-image',
    category: 'fun',
    tags: ['dance', 'loop', 'animation'],
    assets: {
      
    },
    inputs: {
      image: {
        type: 'image',
        required: true,
        label: 'Photo',
      },
    },
    generation: {
      prompt: '{image} dancing',
      negative_prompt: 'static',
      models: ['wan-2.2'],
      default_model: 'kling-v3',
      defaults: { guidance_scale: 5 },
      model_overrides: {},
    },
  },
]

// --- Helpers ---

/**
 * Runs the same filtering logic used by useFilteredEffects,
 * but against raw store state so we don't need React rendering.
 */
function getFilteredEffects(): EffectManifest[] {
  const { effects, searchQuery, activeCategory } = useEffectsStore.getState()
  return effects.filter((e) => {
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

function getSelectedEffect(): EffectManifest | null {
  const { effects, selectedEffectId } = useEffectsStore.getState()
  if (!selectedEffectId) return null
  return (
    effects.find((e) => {
      const fullId = `${e.type}/${e.id}`
      return fullId === selectedEffectId
    }) ?? null
  )
}

// --- Tests ---

beforeEach(() => {
  useEffectsStore.setState({
    effects: [],
    status: 'idle',
    error: null,
    selectedEffectId: null,
    searchQuery: '',
    activeCategory: 'all',
  })
})

describe('effectsStore', () => {
  describe('basic actions', () => {
    it('selectEffect sets selectedEffectId', () => {
      useEffectsStore.getState().selectEffect('single-image/zoom-from-space')
      expect(useEffectsStore.getState().selectedEffectId).toBe('single-image/zoom-from-space')
    })

    it('setSearchQuery updates searchQuery', () => {
      useEffectsStore.getState().setSearchQuery('portrait')
      expect(useEffectsStore.getState().searchQuery).toBe('portrait')
    })

    it('setActiveCategory updates activeCategory', () => {
      useEffectsStore.getState().setActiveCategory('cinematic')
      expect(useEffectsStore.getState().activeCategory).toBe('cinematic')
    })
  })

  describe('useFilteredEffects (filter logic)', () => {
    it('returns all effects when no search/category filter is active', () => {
      useEffectsStore.setState({ effects: mockEffects })
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(3)
    })

    it('filters by name (case-insensitive)', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setSearchQuery('warm hug')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('hug-effect')
    })

    it('filters by name with mixed case query', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setSearchQuery('ZOOM')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('zoom-from-space')
    })

    it('filters by tags', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setSearchQuery('embrace')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('hug-effect')
    })

    it('filters by description', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setSearchQuery('seamless')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('dance-loop')
    })

    it('category "single-image" returns only single-image effects', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setActiveCategory('single-image')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(2)
      expect(filtered.every((e) => e.type === 'single-image')).toBe(true)
    })

    it('category "all" returns everything', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setActiveCategory('all')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(3)
    })

    it('combined search + category filter', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setActiveCategory('single-image')
      useEffectsStore.getState().setSearchQuery('dance')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('dance-loop')
    })

    it('returns empty array when no effects match', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setSearchQuery('nonexistent-effect-xyz')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(0)
    })

    it('category filter by category field matches', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setActiveCategory('emotional')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('hug-effect')
    })
  })

  describe('useSelectedEffect (selector logic)', () => {
    it('returns correct effect when ID matches', () => {
      useEffectsStore.setState({
        effects: mockEffects,
        selectedEffectId: 'single-image/zoom-from-space',
      })
      const selected = getSelectedEffect()
      expect(selected).not.toBeNull()
      expect(selected!.id).toBe('zoom-from-space')
      expect(selected!.name).toBe('Zoom From Space')
    })

    it('returns null when no selection', () => {
      useEffectsStore.setState({
        effects: mockEffects,
        selectedEffectId: null,
      })
      const selected = getSelectedEffect()
      expect(selected).toBeNull()
    })

    it('returns null when ID does not match any effect', () => {
      useEffectsStore.setState({
        effects: mockEffects,
        selectedEffectId: 'single-image/nonexistent',
      })
      const selected = getSelectedEffect()
      expect(selected).toBeNull()
    })

    it('matches effect using type/id format', () => {
      useEffectsStore.setState({
        effects: mockEffects,
        selectedEffectId: 'image-transition/hug-effect',
      })
      const selected = getSelectedEffect()
      expect(selected).not.toBeNull()
      expect(selected!.type).toBe('image-transition')
    })
  })
})
