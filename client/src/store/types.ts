import type { EffectManifest, RunRecord, ModelInfo } from '@/types/api'

// ─── Shared types ────────────────────────────────────────────────────────────

export type ThemeSetting = 'dark' | 'light' | 'auto'
export type LeftPanel = 'gallery' | 'run-result' | 'progress'
export type JobStatus = 'processing' | 'completed' | 'failed'
export type LoadStatus = 'idle' | 'loading' | 'succeeded' | 'failed'
export type EffectSource = 'all' | 'official' | 'mine' | 'installed'
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
  url: string
}

// ─── Slice interfaces ────────────────────────────────────────────────────────

export interface EffectsSlice {
  items: EffectManifest[]
  status: LoadStatus
  error: string | null
  selectedId: string | null
  searchQuery: string
  activeSource: EffectSource
  activeType: string
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
}

export interface HistorySlice {
  // Global history (header popup)
  items: RunRecord[]
  total: number
  activeCount: number
  status: LoadStatus
  isOpen: boolean

  // Per-effect history (right panel tab)
  effectItems: RunRecord[]
  effectTotal: number
  effectStatus: LoadStatus
  effectId: string | null
}

export interface ConfigSlice {
  hasApiKey: boolean
  theme: ThemeSetting
  defaultModel: string
  availableModels: ModelInfo[]
  updateAvailable: string | null
  showOnboarding: boolean
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

// ─── Root state ──────────────────────────────────────────────────────────────

export interface AppState {
  effects: EffectsSlice
  run: RunSlice
  history: HistorySlice
  config: ConfigSlice
  editor: EditorSlice
}
