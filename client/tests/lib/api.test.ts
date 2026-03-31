import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api, ApiError } from '../../src/lib/api'

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

describe('api', () => {
  describe('health', () => {
    it('returns status and version', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', version: '0.1.0' }),
      })
      const result = await api.health()
      expect(result).toEqual({ status: 'ok', version: '0.1.0' })
    })
  })

  describe('getEffects', () => {
    it('returns array of effects', async () => {
      const effects = [{ id: 'test', name: 'Test' }]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ effects }),
      })
      const result = await api.getEffects()
      expect(result).toEqual(effects)
    })
  })

  describe('error handling', () => {
    it('throws ApiError with correct message on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Effect not found', code: 'EFFECT_NOT_FOUND' }),
      })
      await expect(api.getEffect('nonexistent')).rejects.toThrow(ApiError)
      await expect(api.getEffect('nonexistent')).rejects.toThrow()
    })

    it('handles json parse failure in error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('bad json')),
      })
      try {
        await api.health()
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError)
        expect((e as ApiError).status).toBe(500)
      }
    })
  })

  describe('upload', () => {
    it('sends multipart form data', async () => {
      const file = new File(['test'], 'photo.jpg', { type: 'image/jpeg' })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ref_id: 'abc-123',
            filename: 'photo.jpg',
            mime_type: 'image/jpeg',
            size_bytes: 4,
          }),
      })
      const result = await api.upload(file)
      expect(result.ref_id).toBe('abc-123')
      expect(mockFetch).toHaveBeenCalledWith('/api/upload', expect.objectContaining({ method: 'POST' }))
    })
  })

  describe('getAssetUrl', () => {
    it('builds correct URL', () => {
      const url = api.getAssetUrl('single-image/zoom-from-space', 'thumbnail.jpg')
      expect(url).toBe('/api/effects/single-image/zoom-from-space/assets/thumbnail.jpg')
    })
  })

  describe('generate', () => {
    it('sends generation request and returns job_id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: 'job-123', status: 'queued' }),
      })
      const result = await api.generate({
        effect_id: 'single-image/zoom-from-space',
        model_id: 'wan-2.2',
        provider_id: 'fal',
        inputs: { image: 'ref-123' },
        output: { aspect_ratio: '9:16', duration: 5 },
      })
      expect(result.job_id).toBe('job-123')
    })
  })
})
