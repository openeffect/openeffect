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
    effect_type: 'single_image',
    category: 'cinematic',
    tags: ['zoom', 'space', 'dramatic', 'portrait'],
    assets: {
      thumbnail: 'thumbnail.jpg',
    },
    inputs: {
      image: {
        type: 'image',
        required: true,
        label: 'Photo',
        accept: ['image/jpeg', 'image/png'],
        max_size_mb: 10,
      },
    },
    output: {
      aspect_ratios: ['9:16', '16:9'],
      default_aspect_ratio: '9:16',
      durations: [3, 5],
      default_duration: 5,
    },
    generation: {
      prompt_template: 'zoom from space to {image}',
      negative_prompt: 'blurry, low quality',
      supported_models: ['fal-ai/wan-2.2'],
      default_model: 'fal-ai/wan-2.2',
      parameters: { guidance_scale: 7.5 },
      model_overrides: {},
      advanced_parameters: [],
    },
  },
  {
    id: 'hug-effect',
    name: 'Warm Hug',
    description: 'Two people share a warm embrace',
    version: '1.0.0',
    author: 'openeffect',
    effect_type: 'image_transition',
    category: 'emotional',
    tags: ['hug', 'embrace', 'love'],
    assets: {
      thumbnail: 'thumbnail.jpg',
      preview: 'preview.mp4',
    },
    inputs: {
      image_a: {
        type: 'image',
        required: true,
        label: 'Person A',
        accept: ['image/jpeg'],
        max_size_mb: 10,
      },
      image_b: {
        type: 'image',
        required: true,
        label: 'Person B',
        accept: ['image/jpeg'],
        max_size_mb: 10,
      },
    },
    output: {
      aspect_ratios: ['9:16'],
      default_aspect_ratio: '9:16',
      durations: [5],
      default_duration: 5,
    },
    generation: {
      prompt_template: '{image_a} hugs {image_b}',
      negative_prompt: '',
      supported_models: ['fal-ai/wan-2.2'],
      default_model: 'fal-ai/wan-2.2',
      parameters: {},
      model_overrides: {},
      advanced_parameters: [],
    },
  },
  {
    id: 'dance-loop',
    name: 'Dance Loop',
    description: 'A seamless dancing loop animation',
    version: '1.0.0',
    author: 'openeffect',
    effect_type: 'single_image',
    category: 'fun',
    tags: ['dance', 'loop', 'animation'],
    assets: {
      thumbnail: 'thumbnail.jpg',
    },
    inputs: {
      image: {
        type: 'image',
        required: true,
        label: 'Photo',
        accept: ['image/jpeg', 'image/png'],
        max_size_mb: 10,
      },
    },
    output: {
      aspect_ratios: ['1:1', '9:16'],
      default_aspect_ratio: '1:1',
      durations: [3, 5, 10],
      default_duration: 5,
    },
    generation: {
      prompt_template: '{image} dancing',
      negative_prompt: 'static',
      supported_models: ['fal-ai/wan-2.2'],
      default_model: 'fal-ai/wan-2.2',
      parameters: { guidance_scale: 5 },
      model_overrides: {},
      advanced_parameters: [],
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

function getSelectedEffect(): EffectManifest | null {
  const { effects, selectedEffectId } = useEffectsStore.getState()
  if (!selectedEffectId) return null
  return (
    effects.find((e) => {
      const fullId = `${e.effect_type.replace(/_/g, '-')}/${e.id}`
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

    it('category "single-image" returns only single_image effects', () => {
      useEffectsStore.setState({ effects: mockEffects })
      useEffectsStore.getState().setActiveCategory('single-image')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(2)
      expect(filtered.every((e) => e.effect_type === 'single_image')).toBe(true)
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

    it('matches effect using effect_type/id format with underscore-to-hyphen conversion', () => {
      useEffectsStore.setState({
        effects: mockEffects,
        selectedEffectId: 'image-transition/hug-effect',
      })
      const selected = getSelectedEffect()
      expect(selected).not.toBeNull()
      expect(selected!.effect_type).toBe('image_transition')
    })
  })
})
