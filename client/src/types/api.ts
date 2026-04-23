export interface SelectOption {
  value: string
  label: string
}

export type InputFieldSchema =
  | {
      type: 'image'
      role?: string
      required: boolean
      label: string
      hint?: string
      default?: string
      advanced?: boolean
    }
  | {
      type: 'text'
      role?: string
      required: boolean
      label: string
      placeholder?: string
      max_length?: number
      multiline: boolean
      hint?: string
      advanced?: boolean
    }
  | {
      type: 'select'
      role?: string
      required: boolean
      label: string
      options: SelectOption[]
      default: string
      display?: 'pills' | 'dropdown'
      hint?: string
      advanced?: boolean
    }
  | {
      type: 'slider'
      role?: string
      required: boolean
      label: string
      min: number
      max: number
      step: number
      default: number
      unit?: string
      hint?: string
      advanced?: boolean
    }
  | {
      type: 'number'
      role?: string
      required: boolean
      label: string
      min?: number
      max?: number
      step?: number
      default: number
      hint?: string
      advanced?: boolean
    }

export interface Assets {
  preview?: string
  inputs?: Record<string, string>
}

export type ModelParamEntry =
  | { default: number | string }
  | { value: number | string }

export interface ModelOverride {
  prompt?: string
  params?: Record<string, ModelParamEntry>
}

export interface GenerationConfig {
  prompt: string
  negative_prompt: string
  models: string[]
  default_model: string
  params: Record<string, ModelParamEntry>
  model_overrides: Record<string, ModelOverride>
  reverse: boolean
}

export interface EffectManifest {
  id: string
  namespace: string
  name: string
  description: string
  version: string
  author: string
  url?: string
  type: string
  tags: string[]
  assets: Assets
  inputs: Record<string, InputFieldSchema>
  generation: GenerationConfig
  source: 'official' | 'url' | 'archive' | 'local'
  db_id: string
  compatible_models: string[]
  is_favorite: boolean
}

export interface RunRecord {
  id: string
  kind: 'effect' | 'playground'
  effect_id: string | null
  effect_name: string | null
  model_id: string
  status: 'processing' | 'completed' | 'failed'
  progress: number
  progress_msg: string | null
  video_url: string | null
  inputs: unknown
  error: string | null
  created_at: string
  updated_at: string
  duration_ms: number | null
}

export interface ModelParam {
  // Canonical (provider-agnostic) key. For image inputs, the canonical key
  // IS the semantic role (e.g. "start_frame", "end_frame").
  key: string
  type: 'image' | 'select' | 'slider' | 'number' | 'text' | 'boolean'
  required?: boolean
  ui?: 'main' | 'advanced' | 'none'
  label?: string
  default?: string | number | boolean
  options?: { value: string | number; label: string }[]
  min?: number
  max?: number
  step?: number
  hint?: string
  multiline?: boolean
  /** Hidden from the effect page form — only shown in Playground. Manifest
   *  authors tune it via YAML; effect runners never see the control. */
  effect_hidden?: boolean
  /** Runtime user preference — never settable via manifest. Always rendered
   *  as a user control (both effect page and Playground). */
  user_only?: boolean
  /** This field's value changes the final bill. UI renders a `$` badge
   *  next to the label so the user knows to watch the cost popup; the
   *  system doesn't compute a precise estimate. */
  price_affecting?: boolean
}

export interface ModelVariant {
  params: ModelParam[]
  /** Provider's own pricing string for this variant, copied verbatim from
   *  the provider's pricing page (e.g. "$0.084 per second (audio off)…").
   *  Variants of the same model can price differently, so it lives here
   *  rather than at the provider level. */
  cost?: string
}

export interface ModelProvider {
  id: string
  name: string
  type: 'cloud' | 'local'
  is_available: boolean
  variants: Record<string, ModelVariant>
}

export interface ModelInfo {
  id: string
  name: string
  group: string
  description: string
  providers: ModelProvider[]
}

export interface AppConfig {
  has_api_key: boolean
  /** True when the server read the key from the `FAL_KEY` env var. In this
   *  mode the key always wins over any keyring / DB value, so the UI
   *  shows a read-only notice instead of the editable input. */
  api_key_from_env: boolean
  theme: 'dark' | 'light' | 'auto'
  available_models: ModelInfo[]
  update_available: string | null
  /** True when the server detected a working OS keyring. When false, the
   *  UI surfaces a warning recommending `FAL_KEY` env var before the user
   *  stores the key as plaintext in the SQLite fallback. */
  keyring_available: boolean
}

export interface UploadResponse {
  ref_id: string
  filename: string
  mime_type: string
  size_bytes: number
  thumbnails: {
    '512': string
    '2048': string
  }
}

export interface RunRequest {
  effect_id: string
  model_id: string
  provider_id: string
  inputs: Record<string, string>
  output: Record<string, string | number | boolean>
  user_params?: Record<string, number | string | boolean>
}

export interface PlaygroundRunRequest {
  model_id: string
  provider_id: string
  prompt: string
  negative_prompt?: string
  image_inputs?: Record<string, string>
  output?: Record<string, string | number | boolean>
  user_params?: Record<string, number | string | boolean>
}

export interface RunResponse {
  job_id: string
  /** The just-created run record — lets the client render the rich view
   *  (model, date, inputs, params) immediately without a separate GET. */
  record: RunRecord | null
}

export interface RunsResponse {
  items: RunRecord[]
  total: number
  active_count: number
}
