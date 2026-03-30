export type EffectType = 'single_image' | 'image_transition' | 'image_loop' | 'text_to_video'

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
      accept: string[]
      max_size_mb: number
    }
  | {
      type: 'text'
      required: boolean
      label: string
      placeholder?: string
      hint?: string
      max_length?: number
      multiline: boolean
    }
  | {
      type: 'select'
      required: boolean
      label: string
      default: string
      options: SelectOption[]
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
    }
  | {
      type: 'number'
      required: boolean
      label: string
      default: number
      hint?: string
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

export interface AssetExample {
  input_1?: string
  input_2?: string
  output?: string
}

export interface Assets {
  thumbnail: string
  preview?: string
  example?: AssetExample
}

export interface OutputConfig {
  aspect_ratios: string[]
  default_aspect_ratio: string
  durations: number[]
  default_duration: number
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
  effect_type: EffectType
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
  inputs_summary: string
  error: string | null
  created_at: string
  updated_at: string
  duration_ms: number | null
}

export interface ModelInfo {
  id: string
  name: string
  provider: 'fal' | 'local'
  is_installed: boolean
  description: string
  cost_per_sec?: string
}

export interface AppConfig {
  has_api_key: boolean
  default_model: string
  theme: 'dark' | 'light'
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
  inputs: Record<string, string>
  output: {
    aspect_ratio: string
    duration: number
  }
  user_params?: Record<string, number | string>
}

export interface GenerateResponse {
  job_id: string
  status: string
}

export interface HistoryResponse {
  items: GenerationRecord[]
  total: number
  active_count: number
}
