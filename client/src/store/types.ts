import type { EffectManifest, RunRecord, ModelInfo } from '@/types/api'

// ─── Shared types ────────────────────────────────────────────────────────────

export type ThemeSetting = 'dark' | 'light' | 'auto'
export type LeftPanel = 'gallery' | 'run-result' | 'progress'
export type JobStatus = 'processing' | 'completed' | 'failed'
export type LoadStatus = 'idle' | 'loading' | 'succeeded' | 'failed'
export type EffectSource = 'all' | 'official' | 'installed' | 'local'
export type RightTab = 'form' | 'history'

export interface ActiveJob {
  jobId: string
  effectName: string
  status: JobStatus
  progress: number
  message: string | null
  videoUrl: string | null
  error: string | null
}

export interface RestoredParams {
  modelId: string
  inputs: Record<string, string>
  output: Record<string, string | number>
  userParams?: Record<string, unknown>
}

export interface AssetFile {
  filename: string
  size: number
  /** Original-bytes URL — used for downloads and full-size previews.
   *  Composed thumbnails: `/api/files/<id>/512.webp` or `/1024.webp`. */
  url: string
  /** UUID7 of the underlying file row. */
  id: string
}

// ─── Slice interfaces ────────────────────────────────────────────────────────

export interface EffectsSlice {
  // Keyed by effect UUID. Using Map for O(1) lookup and stable insertion order
  // (same pattern as RunSlice.jobs). Selectors expose this as an array to
  // components — internals read/write by key.
  items: Map<string, EffectManifest>
  status: LoadStatus
  error: string | null
  selectedId: string | null
  searchQuery: string
  activeSource: EffectSource
  activeCategory: string
  rightTab: RightTab
}

export interface RunSlice {
  jobs: Map<string, ActiveJob>
  viewingJobId: string | null
  viewingRunRecord: RunRecord | null
  leftPanel: LeftPanel
  restoredParams: RestoredParams | null
  restoringFromUrl: boolean
  // Last run id whose params were applied to a form (via Generate or Reuse).
  // The RestoreFormBanner uses this to hide itself for the run that's already
  // loaded in the form, so it only nags about runs you haven't applied yet.
  lastAppliedRunId: string | null
}

export interface HistorySlice {
  // All three collections are keyed by RunRecord.id and use Map for O(1)
  // lookup. Insertion order is preserved, which matters because the server
  // returns runs pre-sorted by created_at DESC — appending a page with
  // `set(id, run)` keeps the oldest-last viewport ordering that components expect.

  // Global history (header popup)
  items: Map<string, RunRecord>
  total: number
  activeCount: number
  status: LoadStatus
  isOpen: boolean

  // Per-effect history (right panel tab)
  effectItems: Map<string, RunRecord>
  effectTotal: number
  effectStatus: LoadStatus
  effectId: string | null

  // Playground history (right panel tab)
  playgroundItems: Map<string, RunRecord>
  playgroundTotal: number
  playgroundStatus: LoadStatus
  playgroundLoaded: boolean
}

export interface ConfigSlice {
  hasApiKey: boolean
  apiKeyFromEnv: boolean
  theme: ThemeSetting
  availableModels: ModelInfo[]
  updateAvailable: string | null
  showOnboarding: boolean
  keyringAvailable: boolean
}

export interface EditorSlice {
  yamlContent: string
  lastSavedYaml: string
  savedManifest: EffectManifest | null
  editingEffectId: string | null
  assetFiles: AssetFile[]
  isOpen: boolean
  isSaving: boolean
  isForking: boolean
  saveError: string | null
  saveVersion: number
}

export interface PlaygroundSlice {
  isOpen: boolean
}

// ─── Root state ──────────────────────────────────────────────────────────────

export interface AppState {
  effects: EffectsSlice
  run: RunSlice
  history: HistorySlice
  config: ConfigSlice
  editor: EditorSlice
  playground: PlaygroundSlice
}
