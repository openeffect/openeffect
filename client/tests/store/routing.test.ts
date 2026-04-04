import { describe, it, expect } from 'vitest'

import { parseRoute } from '../../src/utils/router'

// URLs now use single-segment UUIDs: /effects/:uuid

describe('URL routing', () => {
  describe('parseRoute', () => {
    it('returns gallery for root path', () => {
      expect(parseRoute('/')).toEqual({ page: 'gallery' })
    })

    it('returns gallery for /effects', () => {
      expect(parseRoute('/effects')).toEqual({ page: 'gallery' })
    })

    it('parses effect URL with UUID', () => {
      expect(parseRoute('/effects/abc-123-def')).toEqual({
        page: 'effect',
        effectId: 'abc-123-def',
        runId: null,
      })
    })

    it('parses edit URL with UUID', () => {
      expect(parseRoute('/effects/abc-123-def/edit')).toEqual({
        page: 'edit',
        effectId: 'abc-123-def',
      })
    })

    it('returns gallery for unknown paths', () => {
      expect(parseRoute('/settings')).toEqual({ page: 'gallery' })
    })

    it('returns gallery for bare effects prefix', () => {
      expect(parseRoute('/effects')).toEqual({ page: 'gallery' })
    })

    it('parses real UUID format', () => {
      expect(parseRoute('/effects/019504a3-7c5f-7000-8abc-1234567890ab')).toEqual({
        page: 'effect',
        effectId: '019504a3-7c5f-7000-8abc-1234567890ab',
        runId: null,
      })
    })

    it('parses edit with real UUID', () => {
      expect(parseRoute('/effects/019504a3-7c5f-7000-8abc-1234567890ab/edit')).toEqual({
        page: 'edit',
        effectId: '019504a3-7c5f-7000-8abc-1234567890ab',
      })
    })
  })
})
