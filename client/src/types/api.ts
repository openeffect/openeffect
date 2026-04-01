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
    }

export interface Assets {
  preview?: string
  inputs?: Record<string, string>
}

export interface ModelOverride {
  prompt?: string
  defaults?: Record<string, number | string>
}

export interface GenerationConfig {
  prompt: string
  negative_prompt: string
  models: string[]
  default_model: string
  defaults: Record<string, number | string>
  model_overrides: Record<string, ModelOverride>
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
  category: string
  tags: string[]
  assets: Assets
  inputs: Record<string, InputFieldSchema>
  generation: GenerationConfig
  source: 'official' | 'url' | 'archive' | 'local'
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
  id: string
  name: string
  type: 'cloud' | 'local'
  cost?: string
  is_available: boolean
}

export interface ModelInfo {
  id: string
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
  available_models: ModelInfo[]
  update_available: string | null
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

export interface GenerationRequest {
  effect_id: string
  model_id: string
  provider_id: string
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
