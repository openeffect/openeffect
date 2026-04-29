import type {
  EffectManifest,
  AppConfig,
  FileRef,
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
  slug: string
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

  getEffect: (namespace: string, slug: string) =>
    request<EffectManifest>(`/api/effects/${namespace}/${slug}`),

  installEffectFromUrl: (url: string, overwrite = false) =>
    request<{ installed: string[] }>(`/api/effects/install?overwrite=${overwrite}`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  installEffectFromFile: async (file: File, overwrite = false): Promise<{ installed: string[] }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/effects/install/upload?overwrite=${overwrite}`, { method: 'POST', body: form })
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

  uninstallEffect: (namespace: string, slug: string) =>
    request<{ ok: boolean }>(`/api/effects/${namespace}/${slug}`, { method: 'DELETE' }),

  toggleFavorite: (namespace: string, slug: string, favorite: boolean) =>
    request<{ ok: boolean; is_favorite: boolean }>(`/api/effects/${namespace}/${slug}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify({ favorite }),
    }),

  setEffectSource: (namespace: string, slug: string, source: 'installed' | 'local') =>
    request<{ ok: boolean; source: 'installed' | 'local' }>(`/api/effects/${namespace}/${slug}/source`, {
      method: 'PATCH',
      body: JSON.stringify({ source }),
    }),

  // Files (content-addressed blob store)
  uploadFile: async (file: File): Promise<FileRef> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/files', { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new ApiError(res.status, body.code ?? 'UNKNOWN', body.error ?? res.statusText)
    }
    return res.json() as Promise<FileRef>
  },

  // Run
  run: (req: RunRequest) =>
    request<RunResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  playgroundRun: (req: PlaygroundRunRequest) =>
    request<RunResponse>('/api/playground/runs', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  // Runs (history)
  getRuns: (
    limit = 50,
    offset = 0,
    effectId?: string,
    kind?: 'effect' | 'playground',
    status?: 'processing' | 'completed' | 'failed',
  ) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (effectId) params.set('effect_id', effectId)
    if (kind) params.set('kind', kind)
    if (status) params.set('status', status)
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
  saveEffect: (
    yamlContent: string,
    effectId: string | null,
    forkFrom?: string,
  ) =>
    request<{ full_id: string; effect: EffectManifest }>('/api/effects/save', {
      method: 'POST',
      body: JSON.stringify({
        yaml_content: yamlContent,
        effect_id: effectId,
        fork_from: forkFrom,
      }),
    }),

  getEffectEditorData: (namespace: string, slug: string) =>
    request<{
      yaml: string
      files: { filename: string; file: FileRef }[]
    }>(`/api/effects/${namespace}/${slug}/editor`),

  exportEffect: (namespace: string, slug: string) =>
    `/api/effects/${namespace}/${slug}/export`,

  // Per-asset CRUD — each call lands the change on the server
  // immediately so the editor's save is just YAML + metadata.
  uploadEffectAsset: async (
    namespace: string,
    slug: string,
    file: File,
    logicalName?: string,
  ) => {
    const form = new FormData()
    form.append('file', file)
    if (logicalName) form.append('logical_name', logicalName)
    const res = await fetch(`/api/effects/${namespace}/${slug}/assets`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      const detail = body.detail ?? body
      throw new ApiError(res.status, detail.code ?? 'UNKNOWN', detail.error ?? res.statusText)
    }
    return res.json() as Promise<{ filename: string; file: FileRef }>
  },

  renameEffectAsset: (namespace: string, slug: string, oldName: string, newName: string) =>
    request<{ filename: string; file: FileRef }>(
      `/api/effects/${namespace}/${slug}/assets/${encodeURIComponent(oldName)}`,
      { method: 'PATCH', body: JSON.stringify({ new_name: newName }) },
    ),

  deleteEffectAsset: (namespace: string, slug: string, logicalName: string) =>
    request<{ ok: boolean }>(
      `/api/effects/${namespace}/${slug}/assets/${encodeURIComponent(logicalName)}`,
      { method: 'DELETE' },
    ),
}

export { ApiError, InstallConflictError }
