import type { EffectManifest, GenerationRecord, ModelInfo } from '@/types/api'

// ─── Shared types ────────────────────────────────────────────────────────────

export type ThemeSetting = 'dark' | 'light' | 'auto'
export type LeftPanel = 'gallery' | 'progress' | 'result'
export type JobStatus = 'processing' | 'completed' | 'failed'
export type LoadStatus = 'idle' | 'loading' | 'succeeded' | 'failed'
export type EffectSource = 'all' | 'official' | 'mine' | 'installed'

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
  activeCategory: string
}

export interface GenerationSlice {
  jobs: Map<string, ActiveJob>
  viewingJobId: string | null
  leftPanel: LeftPanel
  restoredParams: RestoredParams | null
  restoringFromUrl: boolean
}

export interface HistorySlice {
  items: GenerationRecord[]
  total: number
  activeCount: number
  status: LoadStatus
  isOpen: boolean
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
}

// ─── Root state ──────────────────────────────────────────────────────────────

export interface AppState {
  effects: EffectsSlice
  generation: GenerationSlice
  history: HistorySlice
  config: ConfigSlice
  editor: EditorSlice
}
