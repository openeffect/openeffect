import type { ConfigSlice } from '../types'

export const initialConfigState: ConfigSlice = {
  hasApiKey: false,
  theme: 'auto',
  defaultModel: 'kling-v3',
  availableModels: [],
  updateAvailable: null,
  showOnboarding: false,
}
