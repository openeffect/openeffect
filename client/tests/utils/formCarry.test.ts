import { describe, it, expect } from 'vitest'
import { isValidInputValue, isValidParamValue } from '../../src/utils/formCarry'
import type { InputFieldSchema, ModelParam } from '../../src/types/api'

describe('isValidInputValue', () => {
  describe('text', () => {
    const schema: InputFieldSchema = {
      type: 'text',
      required: false,
      label: 'Scene',
      multiline: false,
      max_length: 10,
    }

    it('accepts a string within max_length', () => {
      expect(isValidInputValue('hello', schema)).toBe(true)
    })

    it('rejects a string longer than max_length', () => {
      expect(isValidInputValue('this is way too long', schema)).toBe(false)
    })

    it('rejects non-strings', () => {
      expect(isValidInputValue(42, schema)).toBe(false)
      expect(isValidInputValue(true, schema)).toBe(false)
    })

    it('accepts any string when max_length is not set', () => {
      const noLimit: InputFieldSchema = { type: 'text', required: false, label: 'X', multiline: false }
      expect(isValidInputValue('a'.repeat(10000), noLimit)).toBe(true)
    })
  })

  describe('select', () => {
    const schema: InputFieldSchema = {
      type: 'select',
      required: false,
      label: 'Style',
      default: 'a',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    }

    it('accepts a value present in options', () => {
      expect(isValidInputValue('a', schema)).toBe(true)
      expect(isValidInputValue('b', schema)).toBe(true)
    })

    it('rejects a value not in options', () => {
      expect(isValidInputValue('z', schema)).toBe(false)
    })
  })

  describe('slider / number', () => {
    const slider: InputFieldSchema = {
      type: 'slider',
      required: false,
      label: 'Strength',
      min: 1,
      max: 10,
      step: 1,
      default: 5,
    }

    it('accepts a number in range', () => {
      expect(isValidInputValue(5, slider)).toBe(true)
      expect(isValidInputValue(1, slider)).toBe(true)
      expect(isValidInputValue(10, slider)).toBe(true)
    })

    it('rejects out-of-range numbers', () => {
      expect(isValidInputValue(0, slider)).toBe(false)
      expect(isValidInputValue(11, slider)).toBe(false)
    })

    it('rejects NaN and non-numbers', () => {
      expect(isValidInputValue(NaN, slider)).toBe(false)
      expect(isValidInputValue('5', slider)).toBe(false)
    })
  })

  describe('boolean', () => {
    const schema: InputFieldSchema = {
      type: 'boolean',
      required: false,
      label: 'Reverse',
    }

    it('accepts the form-state string shape', () => {
      expect(isValidInputValue('true', schema)).toBe(true)
      expect(isValidInputValue('false', schema)).toBe(true)
    })

    it('accepts real booleans too', () => {
      expect(isValidInputValue(true, schema)).toBe(true)
      expect(isValidInputValue(false, schema)).toBe(true)
    })

    it('rejects other strings or numbers', () => {
      expect(isValidInputValue('yes', schema)).toBe(false)
      expect(isValidInputValue(1, schema)).toBe(false)
    })
  })

  describe('image', () => {
    it('always rejects (image carry is role-keyed, not name-keyed)', () => {
      const schema: InputFieldSchema = {
        type: 'image',
        required: true,
        label: 'Photo',
        role: 'start_frame',
      }
      expect(isValidInputValue('any', schema)).toBe(false)
    })
  })
})

describe('isValidParamValue', () => {
  it('select: accepts in-options, rejects out-of-options', () => {
    const param: ModelParam = {
      key: 'resolution',
      type: 'select',
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' },
      ],
    }
    expect(isValidParamValue('1080p', param)).toBe(true)
    expect(isValidParamValue('360p', param)).toBe(false)
  })

  it('slider: accepts in-range, rejects out-of-range', () => {
    const param: ModelParam = {
      key: 'duration',
      type: 'slider',
      min: 2,
      max: 15,
    }
    expect(isValidParamValue(8, param)).toBe(true)
    expect(isValidParamValue(2, param)).toBe(true)
    expect(isValidParamValue(15, param)).toBe(true)
    expect(isValidParamValue(1, param)).toBe(false)
    expect(isValidParamValue(16, param)).toBe(false)
  })

  it('number with no min/max: accepts any number', () => {
    const param: ModelParam = { key: 'seed', type: 'number' }
    expect(isValidParamValue(42, param)).toBe(true)
    expect(isValidParamValue(-1, param)).toBe(true)
  })

  it('number: rejects non-numbers and NaN', () => {
    const param: ModelParam = { key: 'seed', type: 'number' }
    expect(isValidParamValue('42', param)).toBe(false)
    expect(isValidParamValue(NaN, param)).toBe(false)
  })

  it('boolean: only real booleans (params do not store the form-state string shape)', () => {
    const param: ModelParam = { key: 'generate_audio', type: 'boolean' }
    expect(isValidParamValue(true, param)).toBe(true)
    expect(isValidParamValue(false, param)).toBe(true)
    expect(isValidParamValue('true', param)).toBe(false)
  })

  it('text: any string', () => {
    const param: ModelParam = { key: 'note', type: 'text' }
    expect(isValidParamValue('hi', param)).toBe(true)
    expect(isValidParamValue(42, param)).toBe(false)
  })

  it('cross-model option mismatch: a "1080p" valid on Model A is invalid on Model B without it', () => {
    const a: ModelParam = {
      key: 'resolution',
      type: 'select',
      options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
    }
    const b: ModelParam = {
      key: 'resolution',
      type: 'select',
      options: [{ value: '720p', label: '720p' }],
    }
    expect(isValidParamValue('1080p', a)).toBe(true)
    expect(isValidParamValue('1080p', b)).toBe(false)
  })
})
