import type { AppState } from '../types'

export const selectHasApiKey = (s: AppState) => s.config.hasApiKey
export const selectTheme = (s: AppState) => s.config.theme
export const selectDefaultModel = (s: AppState) => s.config.defaultModel
export const selectAvailableModels = (s: AppState) => s.config.availableModels
export const selectUpdateAvailable = (s: AppState) => s.config.updateAvailable
export const selectShowOnboarding = (s: AppState) => s.config.showOnboarding
