import type { AppState } from '../types'

export const selectHasApiKey = (s: AppState) => s.config.hasApiKey
export const selectApiKeyFromEnv = (s: AppState) => s.config.apiKeyFromEnv
export const selectTheme = (s: AppState) => s.config.theme
export const selectAvailableModels = (s: AppState) => s.config.availableModels
export const selectUpdateAvailable = (s: AppState) => s.config.updateAvailable
export const selectShowOnboarding = (s: AppState) => s.config.showOnboarding
