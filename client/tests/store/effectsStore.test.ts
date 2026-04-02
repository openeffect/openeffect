import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../../src/store'
import { selectFilteredEffects, selectSelectedEffect } from '../../src/store/selectors/effectsSelectors'
import { selectEffect, setSearchQuery, setActiveCategory } from '../../src/store/actions/effectsActions'
import type { EffectManifest } from '../../src/types/api'

// --- Mock data ---

const mockEffects: EffectManifest[] = [
  {
    id: 'zoom-from-space',
    namespace: 'openeffect',
    name: 'Zoom From Space',
    description: 'A dramatic zoom from outer space down to a portrait',
    version: '1.0.0',
    author: 'openeffect',
    type: 'single-image',
    category: 'cinematic',
    source: 'official',
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
    namespace: 'openeffect',
    name: 'Warm Hug',
    description: 'Two people share a warm embrace',
    version: '1.0.0',
    author: 'openeffect',
    type: 'image-transition',
    category: 'emotional',
    source: 'official',
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
    namespace: 'openeffect',
    name: 'Dance Loop',
    description: 'A seamless dancing loop animation',
    version: '1.0.0',
    author: 'openeffect',
    type: 'single-image',
    category: 'fun',
    source: 'official',
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

function getFilteredEffects(): EffectManifest[] {
  return selectFilteredEffects(useStore.getState())
}

function getSelectedEffect(): EffectManifest | null {
  return selectSelectedEffect(useStore.getState())
}

// --- Tests ---

beforeEach(() => {
  useStore.setState((s) => {
    s.effects.items = []
    s.effects.status = 'idle'
    s.effects.error = null
    s.effects.selectedId = null
    s.effects.searchQuery = ''
    s.effects.activeCategory = 'all'
    s.effects.activeSource = 'all'
  })
})

describe('effectsStore', () => {
  describe('basic actions', () => {
    it('selectEffect sets selectedId', () => {
      selectEffect('openeffect/zoom-from-space')
      expect(useStore.getState().effects.selectedId).toBe('openeffect/zoom-from-space')
    })

    it('setSearchQuery updates searchQuery', () => {
      setSearchQuery('portrait')
      expect(useStore.getState().effects.searchQuery).toBe('portrait')
    })

    it('setActiveCategory updates activeCategory', () => {
      setActiveCategory('cinematic')
      expect(useStore.getState().effects.activeCategory).toBe('cinematic')
    })
  })

  describe('selectFilteredEffects (filter logic)', () => {
    it('returns all effects when no search/category filter is active', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(3)
    })

    it('filters by name (case-insensitive)', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      setSearchQuery('warm hug')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('hug-effect')
    })

    it('filters by name with mixed case query', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      setSearchQuery('ZOOM')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('zoom-from-space')
    })

    it('filters by tags', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      setSearchQuery('embrace')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('hug-effect')
    })

    it('filters by description', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      setSearchQuery('seamless')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('dance-loop')
    })

    it('category "single-image" returns only single-image effects', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      setActiveCategory('single-image')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(2)
      expect(filtered.every((e) => e.type === 'single-image')).toBe(true)
    })

    it('category "all" returns everything', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      setActiveCategory('all')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(3)
    })

    it('combined search + category filter', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      setActiveCategory('single-image')
      setSearchQuery('dance')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('dance-loop')
    })

    it('returns empty array when no effects match', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      setSearchQuery('nonexistent-effect-xyz')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(0)
    })

    it('category filter by category field matches', () => {
      useStore.setState((s) => { s.effects.items = mockEffects })
      setActiveCategory('emotional')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('hug-effect')
    })
  })

  describe('selectSelectedEffect (selector logic)', () => {
    it('returns correct effect when ID matches', () => {
      useStore.setState((s) => {
        s.effects.items = mockEffects
        s.effects.selectedId = 'openeffect/zoom-from-space'
      })
      const selected = getSelectedEffect()
      expect(selected).not.toBeNull()
      expect(selected!.id).toBe('zoom-from-space')
      expect(selected!.name).toBe('Zoom From Space')
    })

    it('returns null when no selection', () => {
      useStore.setState((s) => {
        s.effects.items = mockEffects
        s.effects.selectedId = null
      })
      const selected = getSelectedEffect()
      expect(selected).toBeNull()
    })

    it('returns null when ID does not match any effect', () => {
      useStore.setState((s) => {
        s.effects.items = mockEffects
        s.effects.selectedId = 'openeffect/nonexistent'
      })
      const selected = getSelectedEffect()
      expect(selected).toBeNull()
    })

    it('matches effect using namespace/id format', () => {
      useStore.setState((s) => {
        s.effects.items = mockEffects
        s.effects.selectedId = 'openeffect/hug-effect'
      })
      const selected = getSelectedEffect()
      expect(selected).not.toBeNull()
      expect(selected!.type).toBe('image-transition')
    })
  })
})
