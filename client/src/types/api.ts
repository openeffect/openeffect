export interface SelectOption {
  value: string
  label: string
}

export type InputFieldSchema =
  | {
      type: 'image'
      role?: 'start_frame' | 'end_frame'
      required: boolean
      label: string
      hint?: string
      advanced?: boolean
    }
  | {
      type: 'text'
      required: boolean
      label: string
      placeholder?: string
      max_length?: number
      multiline: boolean
      hint?: string
      advanced?: boolean
    }
  | {
      type: 'boolean'
      required: boolean
      label: string
      default?: boolean
      hint?: string
      advanced?: boolean
    }
  | {
      type: 'select'
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
      required: boolean
      label: string
      min?: number
      max?: number
      step?: number
      default: number
      hint?: string
      advanced?: boolean
    }

/**
 * Showcase entry as it appears in serialized effect responses.
 *
 * The server resolves manifest filename references (image inputs +
 * preview) into canonical `FileRef` dicts before returning. So a value
 * may be:
 *   - `FileRef` for image inputs and preview that resolved against an
 *     ingested asset
 *   - `null` when the manifest references a logical name that hasn't
 *     been ingested yet (a freshly-saved local effect can name a file
 *     that wasn't uploaded)
 *   - `string` for non-image showcase inputs (text values surfaced for
 *     the form; the server returns these as-is)
 */
export interface Showcase {
  preview?: FileRef | null
  inputs?: Record<string, FileRef | string | null>
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
  /** Manifest schema version. Currently the only supported value is 1.
   *  Required on every manifest — the server rejects manifests without
   *  it. Future schema changes ship as 2, 3, …; the server will then
   *  carry a migration step for older versions. */
  manifest_version: number
  id: string                    // UUID primary key
  namespace: string
  slug: string                  // short identifier within the namespace
  full_id: string               // "namespace/slug" — convenience mirror of the YAML id
  name: string
  description: string
  version: string
  author: string
  url?: string
  category: string
  tags: string[]
  showcases: Showcase[]
  inputs: Record<string, InputFieldSchema>
  generation: GenerationConfig
  source: 'official' | 'installed' | 'local'
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
  /** Result file as a canonical FileRef (or null while in flight / on
   *  failure). Read `output.url` for the video bytes,
   *  `output.thumbnails['512']` for the poster frame. */
  output: FileRef | null
  /** Resolved file refs for every image input on this run, keyed by
   *  the input role / key (e.g. `start_frame`, `end_frame`). The server
   *  walks the stored input list and resolves each id to a FileRef so
   *  the client doesn't have to UUID-pattern-match `inputs` itself. */
  input_files: Record<string, FileRef>
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

/**
 * Canonical reference to a file in the content-addressed store.
 * Returned by every endpoint that exposes a file. Read `url` for the
 * original bytes or `thumbnails["512"]` / `thumbnails["1024"]` for
 * image/video thumbnail tiers — never compose `/api/files/...` URLs
 * by string concat.
 *
 * `thumbnails` is empty for `kind === 'other'`; image and video both
 * carry both webp tiers (videos store poster frames at each tier).
 */
export interface FileRef {
  id: string
  kind: 'image' | 'video' | 'other'
  mime: string
  size: number
  url: string
  thumbnails: Record<string, string>
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
