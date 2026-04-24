import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../../src/store'
import { selectFilteredEffects, selectSelectedEffect } from '../../src/store/selectors/effectsSelectors'
import { selectEffect, setSearchQuery } from '../../src/store/actions/effectsActions'
import type { EffectManifest } from '../../src/types/api'

// --- Mock data ---

const mockEffects: EffectManifest[] = [
  {
    id: 'uuid-zoom-001',
    slug: 'zoom-from-space',
    namespace: 'openeffect',
    full_id: 'openeffect/zoom-from-space',
    name: 'Zoom From Space',
    description: 'A dramatic zoom from outer space down to a portrait',
    version: '1.0.0',
    author: 'openeffect',
    category: 'single-image',
    source: 'official',
    tags: ['zoom', 'space', 'dramatic', 'portrait'],
    showcases: [],
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
      models: ['wan-2.7'],
      default_model: 'kling-3.0',
      params: { guidance_scale: { default: 7.5 } },
      model_overrides: {},
    },
  },
  {
    id: 'uuid-hug-002',
    slug: 'hug-effect',
    namespace: 'openeffect',
    full_id: 'openeffect/hug-effect',
    name: 'Warm Hug',
    description: 'Two people share a warm embrace',
    version: '1.0.0',
    author: 'openeffect',
    category: 'image-transition',
    source: 'official',
    tags: ['hug', 'embrace', 'love'],
    showcases: [{ preview: 'preview.mp4' }],
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
      models: ['wan-2.7'],
      default_model: 'kling-3.0',
      params: {},
      model_overrides: {},
    },
  },
  {
    id: 'uuid-dance-003',
    slug: 'dance-loop',
    namespace: 'openeffect',
    full_id: 'openeffect/dance-loop',
    name: 'Dance Loop',
    description: 'A seamless dancing loop animation',
    version: '1.0.0',
    author: 'openeffect',
    category: 'single-image',
    source: 'official',
    tags: ['dance', 'loop', 'animation'],
    showcases: [],
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
      models: ['wan-2.7'],
      default_model: 'kling-3.0',
      params: { guidance_scale: { default: 5 } },
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

/** Build the by-id Map the store expects. */
function effectsMap(list: EffectManifest[]): Map<string, EffectManifest> {
  return new Map(list.map((e) => [e.id, e]))
}

// --- Tests ---

beforeEach(() => {
  useStore.setState((s) => {
    s.effects.items = new Map()
    s.effects.status = 'idle'
    s.effects.error = null
    s.effects.selectedId = null
    s.effects.searchQuery = ''
    s.effects.activeSource = 'all'
    s.effects.activeType = 'all'
  })
})

describe('effectsStore', () => {
  describe('basic actions', () => {
    it('selectEffect sets selectedId', () => {
      selectEffect('uuid-zoom-001')
      expect(useStore.getState().effects.selectedId).toBe('uuid-zoom-001')
    })

    it('setSearchQuery updates searchQuery', () => {
      setSearchQuery('portrait')
      expect(useStore.getState().effects.searchQuery).toBe('portrait')
    })

    // `setActiveType` is now navigation-driven (URL → popstate → store).
    // The store update path is exercised by the filter tests below via
    // direct `useStore.setState`; the URL plumbing is covered in
    // routing.test.ts. No unit-level test here because Node-env tests
    // have no `window` to observe.
  })

  describe('selectFilteredEffects (filter logic)', () => {
    it('returns all effects when no filters are active', () => {
      useStore.setState((s) => { s.effects.items = effectsMap(mockEffects) })
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(3)
    })

    it('filters by name (case-insensitive)', () => {
      useStore.setState((s) => { s.effects.items = effectsMap(mockEffects) })
      setSearchQuery('warm hug')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].slug).toBe('hug-effect')
    })

    it('filters by name with mixed case query', () => {
      useStore.setState((s) => { s.effects.items = effectsMap(mockEffects) })
      setSearchQuery('ZOOM')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].slug).toBe('zoom-from-space')
    })

    it('filters by tags', () => {
      useStore.setState((s) => { s.effects.items = effectsMap(mockEffects) })
      setSearchQuery('embrace')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].slug).toBe('hug-effect')
    })

    it('filters by description', () => {
      useStore.setState((s) => { s.effects.items = effectsMap(mockEffects) })
      setSearchQuery('seamless')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].slug).toBe('dance-loop')
    })

    it('category "single-image" returns only single-image effects', () => {
      useStore.setState((s) => {
        s.effects.items = effectsMap(mockEffects)
        s.effects.activeCategory = 'single-image'
      })
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(2)
      expect(filtered.every((e) => e.category === 'single-image')).toBe(true)
    })

    it('category "all" returns everything', () => {
      useStore.setState((s) => {
        s.effects.items = effectsMap(mockEffects)
        s.effects.activeCategory = 'all'
      })
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(3)
    })

    it('combined search + category filter', () => {
      useStore.setState((s) => {
        s.effects.items = effectsMap(mockEffects)
        s.effects.activeCategory = 'single-image'
      })
      setSearchQuery('dance')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(1)
      expect(filtered[0].slug).toBe('dance-loop')
    })

    it('returns empty array when no effects match', () => {
      useStore.setState((s) => { s.effects.items = effectsMap(mockEffects) })
      setSearchQuery('nonexistent-effect-xyz')
      const filtered = getFilteredEffects()
      expect(filtered).toHaveLength(0)
    })

  })

  describe('selectSelectedEffect (selector logic)', () => {
    it('returns correct effect when id matches', () => {
      useStore.setState((s) => {
        s.effects.items = effectsMap(mockEffects)
        s.effects.selectedId = 'uuid-zoom-001'
      })
      const selected = getSelectedEffect()
      expect(selected).not.toBeNull()
      expect(selected!.slug).toBe('zoom-from-space')
      expect(selected!.name).toBe('Zoom From Space')
    })

    it('returns null when no selection', () => {
      useStore.setState((s) => {
        s.effects.items = effectsMap(mockEffects)
        s.effects.selectedId = null
      })
      const selected = getSelectedEffect()
      expect(selected).toBeNull()
    })

    it('returns null when ID does not match any effect', () => {
      useStore.setState((s) => {
        s.effects.items = effectsMap(mockEffects)
        s.effects.selectedId = 'nonexistent-uuid'
      })
      const selected = getSelectedEffect()
      expect(selected).toBeNull()
    })

    it('matches effect using the UUID', () => {
      useStore.setState((s) => {
        s.effects.items = effectsMap(mockEffects)
        s.effects.selectedId = 'uuid-hug-002'
      })
      const selected = getSelectedEffect()
      expect(selected).not.toBeNull()
      expect(selected!.category).toBe('image-transition')
    })
  })
})
