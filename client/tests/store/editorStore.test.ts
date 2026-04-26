import { describe, it, expect, beforeEach, vi } from 'vitest'

// Both `api` and the router must be mocked before the action module imports
// them. `vi.mock` is hoisted, so we set the implementations via `vi.fn()`
// here and override them per-test.
vi.mock('@/utils/api', () => ({
  api: {
    saveEffect: vi.fn(),
    getEffectEditorData: vi.fn(),
  },
}))
vi.mock('@/utils/router', () => ({
  navigate: vi.fn(),
  replaceRoute: vi.fn(),
}))

import { useStore } from '../../src/store'
import { saveEffect, updateYaml } from '../../src/store/actions/editorActions'
import { api } from '../../src/utils/api'
import type { EffectManifest } from '../../src/types/api'

const _api = api as unknown as {
  saveEffect: ReturnType<typeof vi.fn>
  getEffectEditorData: ReturnType<typeof vi.fn>
}

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
  // Plant a representative editor state — tests override yamlContent as needed.
  useStore.setState((s) => {
    s.editor.isOpen = true
    s.editor.yamlContent = 'id: my/foo\nname: Foo\n'
    s.editor.lastSavedYaml = ''
    s.editor.editingEffectId = null
    s.editor.savedManifest = null
    s.editor.isSaving = false
    s.editor.saveError = null
    s.editor.saveVersion = 0
    s.effects.items = new Map()
  })
})

describe('saveEffect — id-collision sync', () => {
  it('rewrites yamlContent id line when server auto-suffixes the slug', async () => {
    _api.saveEffect.mockResolvedValueOnce({
      full_id: 'my/foo-2',
      manifest: makeManifest({ slug: 'foo-2', full_id: 'my/foo-2' }),
    })

    await saveEffect()

    const s = useStore.getState().editor
    expect(s.yamlContent).toBe('id: my/foo-2\nname: Foo\n')
    expect(s.lastSavedYaml).toBe('id: my/foo-2\nname: Foo\n')
    expect(s.isSaving).toBe(false)
    expect(s.saveError).toBeNull()
  })

  it('leaves yamlContent alone when user edited the id while save was in flight', async () => {
    _api.saveEffect.mockImplementationOnce(async () => {
      // Simulate the user typing a new id between save start and resolve.
      useStore.setState((s) => {
        s.editor.yamlContent = 'id: my/totally-different\nname: Foo\n'
      })
      return {
        full_id: 'my/foo-2',
        manifest: makeManifest({ slug: 'foo-2', full_id: 'my/foo-2' }),
      }
    })

    await saveEffect()

    const s = useStore.getState().editor
    // The user's deliberate rename mid-save survives — the id-sync only
    // patches when the current id still matches what was submitted.
    expect(s.yamlContent).toBe('id: my/totally-different\nname: Foo\n')
    // lastSavedYaml is built from the submitted YAML with the saved id —
    // so it reflects what the server actually persisted, not the user's
    // in-progress edit.
    expect(s.lastSavedYaml).toBe('id: my/foo-2\nname: Foo\n')
  })

  it('does nothing to yamlContent when server returns the same id', async () => {
    _api.saveEffect.mockResolvedValueOnce({
      full_id: 'my/foo',
      manifest: makeManifest({ full_id: 'my/foo' }),
    })

    await saveEffect()

    const s = useStore.getState().editor
    expect(s.yamlContent).toBe('id: my/foo\nname: Foo\n')
    expect(s.lastSavedYaml).toBe('id: my/foo\nname: Foo\n')
  })

  it('upserts the saved manifest into the effects map at the front', async () => {
    const existing = makeManifest({ id: 'uuid-other', slug: 'other', full_id: 'my/other' })
    useStore.setState((s) => {
      s.effects.items = new Map([[existing.id, existing]])
    })

    const saved = makeManifest({ id: 'uuid-new', slug: 'new', full_id: 'my/new' })
    _api.saveEffect.mockResolvedValueOnce({ full_id: 'my/new', manifest: saved })

    await saveEffect()

    const items = Array.from(useStore.getState().effects.items.values())
    // Newest first — `saveEffect` documents this contract.
    expect(items[0].id).toBe('uuid-new')
    expect(items[1].id).toBe('uuid-other')
  })

  it('updates an existing manifest in place without reordering on re-save', async () => {
    const existing = makeManifest({ id: 'uuid-001', slug: 'foo', full_id: 'my/foo' })
    const sibling = makeManifest({ id: 'uuid-other', slug: 'other', full_id: 'my/other' })
    useStore.setState((s) => {
      s.effects.items = new Map([
        [sibling.id, sibling],
        [existing.id, existing],
      ])
      s.editor.editingEffectId = 'uuid-001'
    })

    const updated = makeManifest({ id: 'uuid-001', slug: 'foo', full_id: 'my/foo', name: 'Foo v2' })
    _api.saveEffect.mockResolvedValueOnce({ full_id: 'my/foo', manifest: updated })

    await saveEffect()

    const items = Array.from(useStore.getState().effects.items.values())
    // Order preserved; in-place update.
    expect(items[0].id).toBe('uuid-other')
    expect(items[1].id).toBe('uuid-001')
    expect(items[1].name).toBe('Foo v2')
  })
})

describe('saveEffect — error handling', () => {
  it('captures the error message and clears the saving flag', async () => {
    _api.saveEffect.mockRejectedValueOnce(new Error('Validation failed'))

    await saveEffect()

    const s = useStore.getState().editor
    expect(s.isSaving).toBe(false)
    expect(s.saveError).toBe('Validation failed')
    // yamlContent is left as-is — no partial write.
    expect(s.yamlContent).toBe('id: my/foo\nname: Foo\n')
  })

  it('falls back to a generic message when the thrown value is not an Error', async () => {
    _api.saveEffect.mockRejectedValueOnce('not an Error')

    await saveEffect()

    const s = useStore.getState().editor
    expect(s.saveError).toBe('Save failed')
  })
})

describe('updateYaml', () => {
  it('replaces yamlContent and clears any stale save error', () => {
    useStore.setState((s) => {
      s.editor.saveError = 'previous error'
    })

    updateYaml('id: my/new\n')

    const s = useStore.getState().editor
    expect(s.yamlContent).toBe('id: my/new\n')
    expect(s.saveError).toBeNull()
  })
})
