import type {
  EffectManifest,
  AppConfig,
  UploadResponse,
  RunResponse,
  RunRequest,
  PlaygroundRunRequest,
  RunRecord,
  RunsResponse,
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

export interface InstallConflictEntry {
  namespace: string
  id: string
  name: string
  existing_version: string
  incoming_version: string
  existing_source: string
}

class InstallConflictError extends Error {
  constructor(public conflicts: InstallConflictEntry[]) {
    super(`${conflicts.length} effect(s) already installed`)
    this.name = 'InstallConflictError'
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText, code: 'UNKNOWN' }))
    const detail = body.detail ?? body
    if (res.status === 409 && detail.code === 'INSTALL_CONFLICT') {
      throw new InstallConflictError(detail.conflicts ?? [])
    }
    throw new ApiError(res.status, detail.code ?? body.code ?? 'UNKNOWN', detail.error ?? body.error ?? res.statusText)
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

  installEffectFromUrl: (url: string, overwrite = false) =>
    request<{ installed: string[] }>(`/api/effects/install?overwrite=${overwrite}`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  installEffectFromFile: async (file: File, overwrite = false): Promise<{ installed: string[] }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/effects/install?overwrite=${overwrite}`, { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      const detail = body.detail ?? body
      if (res.status === 409 && detail.code === 'INSTALL_CONFLICT') {
        throw new InstallConflictError(detail.conflicts ?? [])
      }
      throw new ApiError(res.status, detail.code ?? body.code ?? 'UNKNOWN', detail.error ?? body.error ?? res.statusText)
    }
    return res.json() as Promise<{ installed: string[] }>
  },

  uninstallEffect: (namespace: string, effectId: string) =>
    request<{ ok: boolean }>(`/api/effects/${namespace}/${effectId}`, { method: 'DELETE' }),

  toggleFavorite: (namespace: string, effectId: string, favorite: boolean) =>
    request<{ ok: boolean; is_favorite: boolean }>(`/api/effects/${namespace}/${effectId}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify({ favorite }),
    }),

  setEditable: (namespace: string, effectId: string, editable: boolean) =>
    request<{ ok: boolean; editable: boolean }>(`/api/effects/${namespace}/${effectId}/editable`, {
      method: 'PATCH',
      body: JSON.stringify({ editable }),
    }),

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

  // Run
  run: (req: RunRequest) =>
    request<RunResponse>('/api/run', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  playgroundRun: (req: PlaygroundRunRequest) =>
    request<RunResponse>('/api/playground/run', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  // Runs (history)
  getRuns: (limit = 50, offset = 0, effectId?: string, kind?: 'effect' | 'playground') => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (effectId) params.set('effect_id', effectId)
    if (kind) params.set('kind', kind)
    return request<RunsResponse>(`/api/runs?${params}`)
  },

  getRun: (id: string) =>
    request<RunRecord>(`/api/runs/${id}`),

  deleteRun: (id: string) =>
    request<{ ok: boolean }>(`/api/runs/${id}`, { method: 'DELETE' }),

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

  // Effect editor
  saveEffect: (yamlContent: string, effectId: string | null, forkFrom?: string) =>
    request<{ effect_id: string; manifest: EffectManifest }>('/api/effects/save', {
      method: 'POST',
      body: JSON.stringify({ yaml_content: yamlContent, effect_id: effectId, fork_from: forkFrom }),
    }),

  getEffectEditorData: (namespace: string, effectId: string) =>
    request<{ yaml: string; files: { filename: string; size: number; url: string }[] }>(
      `/api/effects/${namespace}/${effectId}/editor`,
    ),

  exportEffect: (namespace: string, effectId: string) =>
    `/api/effects/${namespace}/${effectId}/export`,

  uploadAsset: async (namespace: string, effectId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/effects/${namespace}/${effectId}/assets/upload`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      const detail = body.detail ?? body
      throw new ApiError(res.status, detail.code ?? 'UNKNOWN', detail.error ?? res.statusText)
    }
    return res.json() as Promise<{ filename: string; size: number; url: string }>
  },

  deleteAsset: (namespace: string, effectId: string, filename: string) =>
    request<{ ok: boolean }>(`/api/effects/${namespace}/${effectId}/assets/file/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),

  renameAsset: (namespace: string, effectId: string, oldName: string, newName: string) =>
    request<{ filename: string; size: number; url: string }>(
      `/api/effects/${namespace}/${effectId}/assets/file/${encodeURIComponent(oldName)}`,
      { method: 'PATCH', body: JSON.stringify({ new_name: newName }) },
    ),
}

export { ApiError, InstallConflictError }
