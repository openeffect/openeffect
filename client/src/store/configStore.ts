import { create } from 'zustand'
import type { ModelInfo } from '@/types/api'
import { api } from '@/lib/api'

interface ConfigStore {
  hasApiKey: boolean
  defaultModel: string
  theme: 'dark' | 'light'
  availableModels: ModelInfo[]
  updateAvailable: string | null
  showOnboarding: boolean
  historyLimit: number

  loadConfig: () => Promise<void>
  saveApiKey: (key: string) => Promise<void>
  setTheme: (theme: 'dark' | 'light') => void
  updateConfig: (patch: Record<string, unknown>) => Promise<void>
  dismissOnboarding: () => void
}

export const useConfigStore = create<ConfigStore>((set) => ({
  hasApiKey: false,
  defaultModel: 'fal-ai/wan-2.2',
  theme: 'dark',
  availableModels: [],
  updateAvailable: null,
  showOnboarding: false,
  historyLimit: 50,

  loadConfig: async () => {
    try {
      const config = await api.getConfig()
      const showOnboarding = !config.has_api_key && !config.available_models.some(
        (m) => m.provider === 'local' && m.is_installed,
      )
      set({
        hasApiKey: config.has_api_key,
        defaultModel: config.default_model,
        theme: config.theme,
        availableModels: config.available_models,
        updateAvailable: config.update_available,
        historyLimit: config.history_limit,
        showOnboarding,
      })
      document.documentElement.setAttribute('data-theme', config.theme)
    } catch {
      // Config load failure is non-fatal
    }
  },

  saveApiKey: async (key) => {
    await api.updateConfig({ fal_api_key: key })
    set({ hasApiKey: true, showOnboarding: false })
  },

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
    api.updateConfig({ theme }).catch(() => {})
  },

  updateConfig: async (patch) => {
    const config = await api.updateConfig(patch)
    set({
      hasApiKey: config.has_api_key,
      defaultModel: config.default_model,
      theme: config.theme,
      historyLimit: config.history_limit,
    })
  },

  dismissOnboarding: () => set({ showOnboarding: false }),
}))
