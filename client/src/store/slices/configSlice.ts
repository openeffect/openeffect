import type { ConfigSlice } from '../types'

export const initialConfigState: ConfigSlice = {
  hasApiKey: false,
  apiKeyFromEnv: false,
  theme: 'auto',
  availableModels: [],
  updateAvailable: null,
  showOnboarding: false,
}
