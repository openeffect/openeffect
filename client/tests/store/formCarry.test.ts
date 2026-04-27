import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../../src/store'
import {
  mutateSetCarriedImage,
  mutateClearCarriedImage,
  mutateSetCarriedInput,
  mutateClearCarriedInput,
  mutateSetCarriedParam,
  mutateClearCarriedParam,
  mutateSetCarriedModel,
  mutateSetCarriedPlaygroundPrompt,
  mutateSetCarriedPlaygroundNegativePrompt,
} from '../../src/store/mutations/formCarryMutations'
import { initialFormCarryState } from '../../src/store/slices/formCarrySlice'

beforeEach(() => {
  useStore.setState((s) => {
    s.formCarry = {
      lastImagesByRole: {},
      lastInputsByName: {},
      lastModelParams: {},
      lastModelId: null,
      lastPlaygroundPrompt: '',
      lastPlaygroundNegativePrompt: '',
    }
  })
})

describe('formCarry slice', () => {
  it('starts empty', () => {
    expect(initialFormCarryState).toEqual({
      lastImagesByRole: {},
      lastInputsByName: {},
      lastModelParams: {},
      lastModelId: null,
      lastPlaygroundPrompt: '',
      lastPlaygroundNegativePrompt: '',
    })
    expect(useStore.getState().formCarry.lastImagesByRole).toEqual({})
    expect(useStore.getState().formCarry.lastInputsByName).toEqual({})
    expect(useStore.getState().formCarry.lastModelParams).toEqual({})
    expect(useStore.getState().formCarry.lastModelId).toBeNull()
    expect(useStore.getState().formCarry.lastPlaygroundPrompt).toBe('')
    expect(useStore.getState().formCarry.lastPlaygroundNegativePrompt).toBe('')
  })

  it('mutateSetCarriedImage stores a file_id string by role', () => {
    useStore.setState((s) => mutateSetCarriedImage(s, 'start_frame', 'abc-uuid'))
    expect(useStore.getState().formCarry.lastImagesByRole).toEqual({
      start_frame: 'abc-uuid',
    })
  })

  it('mutateSetCarriedImage stores a File by role (pre-upload survives the slice)', () => {
    const file = new File(['hello'], 'hello.png', { type: 'image/png' })
    useStore.setState((s) => mutateSetCarriedImage(s, 'start_frame', file))
    const stored = useStore.getState().formCarry.lastImagesByRole.start_frame
    expect(stored).toBe(file)
    expect(stored).toBeInstanceOf(File)
  })

  it('mutateSetCarriedImage overwrites the previous value for the same role', () => {
    useStore.setState((s) => mutateSetCarriedImage(s, 'start_frame', 'first'))
    useStore.setState((s) => mutateSetCarriedImage(s, 'start_frame', 'second'))
    expect(useStore.getState().formCarry.lastImagesByRole.start_frame).toBe('second')
  })

  it('different roles coexist in the slice', () => {
    useStore.setState((s) => mutateSetCarriedImage(s, 'start_frame', 'start-uuid'))
    useStore.setState((s) => mutateSetCarriedImage(s, 'end_frame', 'end-uuid'))
    expect(useStore.getState().formCarry.lastImagesByRole).toEqual({
      start_frame: 'start-uuid',
      end_frame: 'end-uuid',
    })
  })

  it('mutateClearCarriedImage removes a single role and leaves others intact', () => {
    useStore.setState((s) => mutateSetCarriedImage(s, 'start_frame', 'a'))
    useStore.setState((s) => mutateSetCarriedImage(s, 'end_frame', 'b'))
    useStore.setState((s) => mutateClearCarriedImage(s, 'start_frame'))
    expect(useStore.getState().formCarry.lastImagesByRole).toEqual({
      end_frame: 'b',
    })
  })

  it('mutateClearCarriedImage on an unknown role is a no-op', () => {
    useStore.setState((s) => mutateSetCarriedImage(s, 'start_frame', 'a'))
    useStore.setState((s) => mutateClearCarriedImage(s, 'reference'))
    expect(useStore.getState().formCarry.lastImagesByRole).toEqual({
      start_frame: 'a',
    })
  })

  it('stickiness — the slice survives across "effect switches" because nothing else touches it', () => {
    // Effect A uploads `start_frame`.
    useStore.setState((s) => mutateSetCarriedImage(s, 'start_frame', 'cat-uuid'))

    // Simulate visiting Effect C (which has only `end_frame`). C's image
    // handlers can only fire on its own roles, so they never touch
    // `start_frame`. We model that here as a no-op on an unrelated role.
    useStore.setState((s) => mutateClearCarriedImage(s, 'something_else'))

    // Switching to Effect B: `start_frame` is still there, ready to seed.
    expect(useStore.getState().formCarry.lastImagesByRole.start_frame).toBe('cat-uuid')
  })

  describe('inputs by name', () => {
    it('mutateSetCarriedInput stores by manifest input key', () => {
      useStore.setState((s) => mutateSetCarriedInput(s, 'scene_prompt', 'evening city'))
      expect(useStore.getState().formCarry.lastInputsByName).toEqual({
        scene_prompt: 'evening city',
      })
    })

    it('handles strings, numbers and booleans for the various field types', () => {
      useStore.setState((s) => mutateSetCarriedInput(s, 'scene_prompt', 'foo'))
      useStore.setState((s) => mutateSetCarriedInput(s, 'duration', 8))
      useStore.setState((s) => mutateSetCarriedInput(s, 'reverse', true))
      expect(useStore.getState().formCarry.lastInputsByName).toEqual({
        scene_prompt: 'foo',
        duration: 8,
        reverse: true,
      })
    })

    it('mutateClearCarriedInput removes a single key, others stay', () => {
      useStore.setState((s) => mutateSetCarriedInput(s, 'a', 'one'))
      useStore.setState((s) => mutateSetCarriedInput(s, 'b', 'two'))
      useStore.setState((s) => mutateClearCarriedInput(s, 'a'))
      expect(useStore.getState().formCarry.lastInputsByName).toEqual({ b: 'two' })
    })
  })

  describe('model params', () => {
    it('mutateSetCarriedParam stores by canonical key', () => {
      useStore.setState((s) => mutateSetCarriedParam(s, 'resolution', '1080p'))
      useStore.setState((s) => mutateSetCarriedParam(s, 'duration', 8))
      expect(useStore.getState().formCarry.lastModelParams).toEqual({
        resolution: '1080p',
        duration: 8,
      })
    })

    it('mutateClearCarriedParam removes a single key, others stay', () => {
      useStore.setState((s) => mutateSetCarriedParam(s, 'resolution', '720p'))
      useStore.setState((s) => mutateSetCarriedParam(s, 'duration', 5))
      useStore.setState((s) => mutateClearCarriedParam(s, 'resolution'))
      expect(useStore.getState().formCarry.lastModelParams).toEqual({ duration: 5 })
    })

    it('inputs and params buckets are independent — same key in both, different values', () => {
      // A manifest could declare an input named `duration` while a model
      // also has a canonical `duration` param. The two buckets keep them
      // disambiguated.
      useStore.setState((s) => mutateSetCarriedInput(s, 'duration', 'ten seconds'))
      useStore.setState((s) => mutateSetCarriedParam(s, 'duration', 8))
      expect(useStore.getState().formCarry.lastInputsByName.duration).toBe('ten seconds')
      expect(useStore.getState().formCarry.lastModelParams.duration).toBe(8)
    })
  })

  describe('last model id', () => {
    it('mutateSetCarriedModel records the most recent pick', () => {
      useStore.setState((s) => mutateSetCarriedModel(s, 'wan-2.7'))
      expect(useStore.getState().formCarry.lastModelId).toBe('wan-2.7')
      useStore.setState((s) => mutateSetCarriedModel(s, 'kling-3.0'))
      expect(useStore.getState().formCarry.lastModelId).toBe('kling-3.0')
    })
  })

  describe('playground prompts', () => {
    it('mutateSetCarriedPlaygroundPrompt overwrites the prompt', () => {
      useStore.setState((s) => mutateSetCarriedPlaygroundPrompt(s, 'a moonlit beach'))
      expect(useStore.getState().formCarry.lastPlaygroundPrompt).toBe('a moonlit beach')
      useStore.setState((s) => mutateSetCarriedPlaygroundPrompt(s, ''))
      expect(useStore.getState().formCarry.lastPlaygroundPrompt).toBe('')
    })

    it('prompt and negative-prompt are independent', () => {
      useStore.setState((s) => mutateSetCarriedPlaygroundPrompt(s, 'P'))
      useStore.setState((s) => mutateSetCarriedPlaygroundNegativePrompt(s, 'N'))
      expect(useStore.getState().formCarry.lastPlaygroundPrompt).toBe('P')
      expect(useStore.getState().formCarry.lastPlaygroundNegativePrompt).toBe('N')
    })
  })
})
