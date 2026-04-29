import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/utils/api', () => ({
  api: {
    toggleFavorite: vi.fn(),
    setEffectSource: vi.fn(),
    uninstallEffect: vi.fn(),
  },
}))
vi.mock('@/utils/router', () => ({
  navigate: vi.fn(),
  replaceRoute: vi.fn(),
  parseRoute: vi.fn(),
  initRouteListener: vi.fn(),
}))

import { useStore } from '../../src/store'
import {
  toggleFavorite,
  setEffectSource,
  deleteEffect,
} from '../../src/store/actions/effectsActions'
import { api } from '../../src/utils/api'
import { navigate } from '../../src/utils/router'
import type { EffectManifest } from '../../src/types/api'

const _api = api as unknown as {
  toggleFavorite: ReturnType<typeof vi.fn>
  setEffectSource: ReturnType<typeof vi.fn>
  uninstallEffect: ReturnType<typeof vi.fn>
}
const _nav = navigate as unknown as ReturnType<typeof vi.fn>

function makeManifest(overrides: Partial<EffectManifest> = {}): EffectManifest {
  return {
    manifest_version: 1,
    id: 'uuid-001',
    full_id: 'my/foo',
    namespace: 'my',
    slug: 'foo',
    name: 'Foo',
    description: '',
    version: '0.1.0',
    author: 'me',
    category: 'transform',
    source: 'local',
    is_favorite: false,
    compatible_models: [],
    tags: [],
    showcases: [],
    inputs: {},
    generation: {
      prompt: '',
      negative_prompt: '',
      models: [],
      default_model: '',
      params: {},
      model_overrides: {},
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState((s) => {
    s.effects.items = new Map()
    s.effects.selectedId = null
    s.history.status = 'succeeded'
    s.history.effectStatus = 'succeeded'
    s.history.effectId = null
    s.history.effectItems = new Map()
  })
})

describe('toggleFavorite - optimistic update', () => {
  it('flips is_favorite immediately and persists on success', async () => {
    const m = makeManifest({ is_favorite: false })
    useStore.setState((s) => {
      s.effects.items = new Map([[m.id, m]])
    })
    _api.toggleFavorite.mockResolvedValueOnce({ ok: true })

    const promise = toggleFavorite(m)
    // Immediate: store flipped before the await resolves.
    expect(useStore.getState().effects.items.get(m.id)!.is_favorite).toBe(true)
    await promise

    expect(_api.toggleFavorite).toHaveBeenCalledWith('my', 'foo', true)
    expect(useStore.getState().effects.items.get(m.id)!.is_favorite).toBe(true)
  })

  it('reverts is_favorite when the API call rejects', async () => {
    const m = makeManifest({ is_favorite: false })
    useStore.setState((s) => {
      s.effects.items = new Map([[m.id, m]])
    })
    _api.toggleFavorite.mockRejectedValueOnce(new Error('500 Internal'))

    await toggleFavorite(m)

    // Reverted to the original value - UI should show the unfavorited
    // state again because the server didn't accept the change.
    expect(useStore.getState().effects.items.get(m.id)!.is_favorite).toBe(false)
  })
})

describe('setEffectSource - optimistic update', () => {
  it('moves an effect from installed to local immediately', async () => {
    const m = makeManifest({ source: 'installed' })
    useStore.setState((s) => {
      s.effects.items = new Map([[m.id, m]])
    })
    _api.setEffectSource.mockResolvedValueOnce({ ok: true })

    const promise = setEffectSource(m, 'local')
    expect(useStore.getState().effects.items.get(m.id)!.source).toBe('local')
    await promise

    expect(_api.setEffectSource).toHaveBeenCalledWith('my', 'foo', 'local')
    expect(useStore.getState().effects.items.get(m.id)!.source).toBe('local')
  })

  it('reverts the source on API failure', async () => {
    const m = makeManifest({ source: 'installed' })
    useStore.setState((s) => {
      s.effects.items = new Map([[m.id, m]])
    })
    _api.setEffectSource.mockRejectedValueOnce(new Error('boom'))

    await setEffectSource(m, 'local')

    expect(useStore.getState().effects.items.get(m.id)!.source).toBe('installed')
  })
})

describe('deleteEffect', () => {
  it('drops the effect from the map, clears caches, and navigates home on success', async () => {
    const m = makeManifest({ id: 'uuid-001' })
    const sibling = makeManifest({ id: 'uuid-002', slug: 'bar', full_id: 'my/bar' })
    useStore.setState((s) => {
      s.effects.items = new Map([
        [m.id, m],
        [sibling.id, sibling],
      ])
      s.effects.selectedId = m.id
      // Per-effect history slice is loaded for the doomed effect - should
      // be wiped so a future open of the same id (after a fork) refetches.
      s.history.effectId = m.id
      s.history.effectStatus = 'succeeded'
      s.history.effectItems = new Map([['run-1', { id: 'run-1' } as never]])
    })
    _api.uninstallEffect.mockResolvedValueOnce({ ok: true })

    await deleteEffect('my', 'foo')

    const state = useStore.getState()
    expect(state.effects.items.has('uuid-001')).toBe(false)
    expect(state.effects.items.has('uuid-002')).toBe(true)
    expect(state.effects.selectedId).toBeNull()
    // Global history cache invalidated (idle) + per-effect cache cleared.
    expect(state.history.status).toBe('idle')
    expect(state.history.effectStatus).toBe('idle')
    expect(state.history.effectId).toBeNull()
    expect(state.history.effectItems.size).toBe(0)
    expect(_nav).toHaveBeenCalledWith('/')
  })

  it('leaves state untouched when the API call rejects', async () => {
    const m = makeManifest({ id: 'uuid-001' })
    useStore.setState((s) => {
      s.effects.items = new Map([[m.id, m]])
      s.effects.selectedId = m.id
    })
    _api.uninstallEffect.mockRejectedValueOnce(new Error('Cannot uninstall'))

    await deleteEffect('my', 'foo')

    const state = useStore.getState()
    // No mutation: the effect is still there, selection is still there,
    // no navigation fired.
    expect(state.effects.items.has('uuid-001')).toBe(true)
    expect(state.effects.selectedId).toBe('uuid-001')
    expect(_nav).not.toHaveBeenCalled()
  })

  it('only drops the per-effect history slice when it matches the deleted id', async () => {
    const m = makeManifest({ id: 'uuid-001' })
    useStore.setState((s) => {
      s.effects.items = new Map([[m.id, m]])
      // Per-effect history is loaded for a DIFFERENT effect - must survive.
      s.history.effectId = 'uuid-other'
      s.history.effectStatus = 'succeeded'
      s.history.effectItems = new Map([['other-run', { id: 'other-run' } as never]])
    })
    _api.uninstallEffect.mockResolvedValueOnce({ ok: true })

    await deleteEffect('my', 'foo')

    const state = useStore.getState()
    // Other effect's per-effect history cache is untouched.
    expect(state.history.effectId).toBe('uuid-other')
    expect(state.history.effectStatus).toBe('succeeded')
    expect(state.history.effectItems.size).toBe(1)
    // Global history cache still gets invalidated (the deleted effect's
    // runs may have appeared there).
    expect(state.history.status).toBe('idle')
  })
})
