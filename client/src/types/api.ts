export interface SelectOption {
  value: string
  label: string
}

export type InputFieldSchema =
  | {
      type: 'image'
      required: boolean
      label: string
      hint?: string
      role?: string
    }
  | {
      type: 'text'
      required: boolean
      label: string
      placeholder?: string
      hint?: string
      max_length?: number
      multiline: boolean
      role?: string
    }
  | {
      type: 'select'
      required: boolean
      label: string
      default: string
      options: SelectOption[]
      role?: string
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
      role?: string
    }
  | {
      type: 'number'
      required: boolean
      label: string
      default: number
      hint?: string
      role?: string
    }

export interface AdvancedParameter {
  key: string
  label: string
  type: 'slider' | 'text' | 'number'
  min?: number
  max?: number
  step?: number
  default?: string | number
  hint?: string
  multiline?: boolean
}

export interface Assets {
  inputs?: Record<string, string>    // keyed by input field name → filename in assets/
  output?: string                     // result video filename in assets/
}

export interface OutputConfig {
  aspect_ratios?: string[]
  default_aspect_ratio?: string
  durations?: number[]
  default_duration?: number
}

export interface ModelOverride {
  prompt_template?: string
  parameters?: Record<string, number | string>
}

export interface GenerationConfig {
  prompt_template: string
  negative_prompt: string
  supported_models: string[]
  default_model: string
  parameters: Record<string, number | string>
  model_overrides: Record<string, ModelOverride>
  advanced_parameters: AdvancedParameter[]
}

export interface EffectManifest {
  id: string
  name: string
  description: string
  version: string
  author: string
  type: string
  category: string
  tags: string[]
  assets: Assets
  inputs: Record<string, InputFieldSchema>
  output: OutputConfig
  generation: GenerationConfig
}

export interface GenerationRecord {
  id: string
  effect_id: string
  effect_name: string
  model_id: string
  status: 'processing' | 'completed' | 'failed'
  progress: number
  progress_msg: string | null
  video_url: string | null
  thumbnail_url: string | null
  manifest_json: unknown
  error: string | null
  created_at: string
  updated_at: string
  duration_ms: number | null
}

export interface ModelParam {
  key: string
  label: string
  type: 'select' | 'slider' | 'number' | 'text'
  default: string | number
  options?: { value: string | number; label: string }[]
  min?: number
  max?: number
  step?: number
  hint?: string
  multiline?: boolean
}

export interface ModelProvider {
  id: string           // "fal" or "local"
  name: string         // "fal.ai" or "Local"
  type: 'cloud' | 'local'
  cost?: string        // "~$0.10/sec"
  is_available: boolean
}

export interface ModelInfo {
  id: string           // "wan-2.2" (plain, no prefix)
  name: string
  description: string
  providers: ModelProvider[]
  output_params?: ModelParam[]
  advanced_params?: ModelParam[]
}

export interface AppConfig {
  has_api_key: boolean
  default_model: string
  theme: 'dark' | 'light' | 'auto'
  history_limit: number
  available_models: ModelInfo[]
  update_available: string | null
}

export interface UploadResponse {
  ref_id: string
  filename: string
  mime_type: string
  size_bytes: number
}

export interface GenerationRequest {
  effect_id: string
  model_id: string
  provider_id: string   // "fal" or "local"
  inputs: Record<string, string>
  output: Record<string, string | number>
  user_params?: Record<string, number | string>
}

export interface GenerateResponse {
  job_id: string
  status: string
}

export interface GenerationsResponse {
  items: GenerationRecord[]
  total: number
  active_count: number
}
