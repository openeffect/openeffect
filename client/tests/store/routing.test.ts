import { describe, it, expect } from 'vitest'

import { parseRoute } from '../../src/utils/router'

// URLs now use single-segment UUIDs: /effects/:uuid.
// Gallery-adjacent routes also carry URL-driven filter context
// (category / source / search) — parseRoute reflects that on the variants
// where a gallery is visible underneath.

const EMPTY_FILTERS = { category: 'all', source: 'all', search: '' } as const

describe('URL routing', () => {
  describe('parseRoute', () => {
    it('returns gallery for root path', () => {
      expect(parseRoute('/')).toEqual({ page: 'gallery', ...EMPTY_FILTERS })
    })

    it('returns gallery for /effects', () => {
      expect(parseRoute('/effects')).toEqual({ page: 'gallery', ...EMPTY_FILTERS })
    })

    it('parses effect URL with UUID', () => {
      expect(parseRoute('/effects/abc-123-def')).toEqual({
        page: 'effect',
        effectId: 'abc-123-def',
        runId: null,
        ...EMPTY_FILTERS,
      })
    })

    it('parses edit URL with UUID', () => {
      expect(parseRoute('/effects/abc-123-def/edit')).toEqual({
        page: 'edit',
        effectId: 'abc-123-def',
        ...EMPTY_FILTERS,
      })
    })

    it('returns gallery for unknown paths', () => {
      expect(parseRoute('/settings')).toEqual({ page: 'gallery', ...EMPTY_FILTERS })
    })

    it('returns gallery for bare effects prefix', () => {
      expect(parseRoute('/effects')).toEqual({ page: 'gallery', ...EMPTY_FILTERS })
    })

    it('parses real UUID format', () => {
      expect(parseRoute('/effects/019504a3-7c5f-7000-8abc-1234567890ab')).toEqual({
        page: 'effect',
        effectId: '019504a3-7c5f-7000-8abc-1234567890ab',
        runId: null,
        ...EMPTY_FILTERS,
      })
    })

    it('parses edit with real UUID', () => {
      expect(parseRoute('/effects/019504a3-7c5f-7000-8abc-1234567890ab/edit')).toEqual({
        page: 'edit',
        effectId: '019504a3-7c5f-7000-8abc-1234567890ab',
        ...EMPTY_FILTERS,
      })
    })
  })
})
