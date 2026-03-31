import { describe, it, expect, beforeEach } from 'vitest'

// Test the parseHash and writeHash functions
// We need to import them — they're exported from effectsStore
import { parseHash, writeHash } from '../../src/store/effectsStore'

describe('URL routing', () => {
  describe('parseHash', () => {
    it('returns null for empty hash', () => {
      expect(parseHash('')).toBeNull()
    })

    it('parses effect URL', () => {
      expect(parseHash('effects/single-image/zoom-from-space')).toEqual({
        mode: 'effect',
        id: 'single-image/zoom-from-space',
      })
    })

    it('parses generation URL', () => {
      expect(parseHash('generations/019504a3-7c5f-7000')).toEqual({
        mode: 'generation',
        id: '019504a3-7c5f-7000',
      })
    })

    it('returns null for unknown prefix', () => {
      expect(parseHash('settings')).toBeNull()
    })

    it('returns null for bare effect ID without prefix', () => {
      expect(parseHash('single-image/zoom-from-space')).toBeNull()
    })

    it('handles effects/ with no ID', () => {
      const result = parseHash('effects/')
      expect(result).toEqual({ mode: 'effect', id: '' })
    })

    it('handles generations/ with no ID', () => {
      const result = parseHash('generations/')
      expect(result).toEqual({ mode: 'generation', id: '' })
    })
  })
})
