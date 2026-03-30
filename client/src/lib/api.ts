import type {
  EffectManifest,
  AppConfig,
  UploadResponse,
  GenerateResponse,
  GenerationRequest,
  HistoryResponse,
} from '@/types/api'

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText, code: 'UNKNOWN' }))
    throw new ApiError(res.status, body.code ?? 'UNKNOWN', body.error ?? res.statusText)
  }

  return res.json() as Promise<T>
}

export const api = {
  // Health
  health: () => request<{ status: string; version: string }>('/api/health'),

  // Effects
  getEffects: () =>
    request<{ effects: EffectManifest[] }>('/api/effects').then((r) => r.effects),

  getEffect: (effectId: string) =>
    request<EffectManifest>(`/api/effects/${effectId}`),

  getAssetUrl: (effectId: string, filename: string) =>
    `/api/effects/${effectId}/assets/${filename}`,

  // Upload
  upload: async (file: File): Promise<UploadResponse> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new ApiError(res.status, body.code ?? 'UNKNOWN', body.error ?? res.statusText)
    }
    return res.json() as Promise<UploadResponse>
  },

  // Generation
  generate: (req: GenerationRequest) =>
    request<GenerateResponse>('/api/generate', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  // History
  getHistory: (limit = 50, offset = 0) =>
    request<HistoryResponse>(`/api/history?limit=${limit}&offset=${offset}`),

  deleteHistory: (id: string) =>
    request<{ ok: boolean }>(`/api/history/${id}`, { method: 'DELETE' }),

  // Config
  getConfig: () => request<AppConfig>('/api/config'),

  updateConfig: (patch: Record<string, unknown>) =>
    request<AppConfig>('/api/config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // Models
  getModels: () =>
    request<{ models: AppConfig['available_models'] }>('/api/models').then((r) => r.models),

  installModel: (modelId: string) =>
    request<{ install_job_id: string; status: string }>('/api/models/install', {
      method: 'POST',
      body: JSON.stringify({ model_id: modelId }),
    }),
}

export { ApiError }
