import type { EffectManifest, FileRef, RunRecord, ModelInfo } from '@/types/api'

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
  /** Logical name on the effect — what the manifest YAML references.
   *  Stable per effect even if the underlying file is replaced. */
  filename: string
  /** Underlying file in the content-addressed store. The `id` is shared
   *  across effects that bind the same bytes; the `url` and
   *  `thumbnails` are pre-composed by the server (no string concat). */
  file: FileRef
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
  /** True while `editEffect` is fetching the YAML + asset list before
   *  it can hand them to `openEditor`. Drives the header spinner so a
   *  click on Edit gives immediate feedback even when the round-trip
   *  is slow. */
  isEditing: boolean
  saveError: string | null
  saveVersion: number
}

export interface PlaygroundSlice {
  isOpen: boolean
}

/** A carried image — either a not-yet-uploaded `File` (the user picked
 *  it but the eager-upload .then hasn't landed yet) or a `file_id` string
 *  (already on the server). Both shapes are valid for the run-submission
 *  path; for preview, only the `file_id` form renders (via the server's
 *  `/api/files/<id>/512.webp`). The brief `File` window is covered by the
 *  ImageUploader's "Uploading…" spinner. */
export type CarriedImage = File | string

export interface FormCarrySlice {
  /** Role-keyed (`start_frame`, `end_frame`, `reference`) — survives effect
   *  switches in memory only. Resets on page reload. */
  lastImagesByRole: Record<string, CarriedImage>
  /** Manifest input values keyed by input name (`scene_prompt`, `mood`, …).
   *  Transferred to a new effect only when the same key exists there and
   *  the value is valid for the target's `InputFieldSchema`. */
  lastInputsByName: Record<string, string | number | boolean>
  /** User-tunable model param values, canonical-keyed (`resolution`,
   *  `duration`, `aspect_ratio`, …). Transferred when the target model's
   *  variant declares the same canonical key and the value is valid for
   *  that variant's range/options. Manifest-locked params never reach
   *  this bucket because they're filtered out of the user-editable list. */
  lastModelParams: Record<string, string | number | boolean>
  /** The user's last-picked model id. Used only as a fallback for effects
   *  whose manifest doesn't declare `default_model` — when it does, that
   *  always wins. */
  lastModelId: string | null
  /** Last prompt typed in the Playground. Persists across navigation
   *  away and back so the user doesn't have to re-type when popping over
   *  to an effect. Playground-only — never read by EffectFormTab (effect
   *  prompts are manifest-driven). */
  lastPlaygroundPrompt: string
  /** Last negative prompt typed in the Playground. Same scope as above. */
  lastPlaygroundNegativePrompt: string
}

// ─── Root state ──────────────────────────────────────────────────────────────

export interface AppState {
  effects: EffectsSlice
  run: RunSlice
  history: HistorySlice
  config: ConfigSlice
  editor: EditorSlice
  playground: PlaygroundSlice
  formCarry: FormCarrySlice
}
