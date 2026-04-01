import { create } from 'zustand'
import type { ModelInfo } from '@/types/api'
import { api } from '@/lib/api'

type ThemeSetting = 'dark' | 'light' | 'auto'

function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(setting: ThemeSetting) {
  const resolved = setting === 'auto' ? getSystemTheme() : setting
  document.documentElement.setAttribute('data-theme', resolved)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('theme', setting)
  }
}

// Apply saved theme immediately — before React renders, prevents flash
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || saved === 'light' || saved === 'auto') {
    applyTheme(saved)
  }
}

function parseTheme(value: unknown): ThemeSetting {
  if (value === 'dark' || value === 'light' || value === 'auto') return value
  return 'auto'
}

interface ConfigStore {
  hasApiKey: boolean
  defaultModel: string
  theme: ThemeSetting
  availableModels: ModelInfo[]
  updateAvailable: string | null
  showOnboarding: boolean

  loadConfig: () => Promise<void>
  saveApiKey: (key: string) => Promise<void>
  setTheme: (theme: ThemeSetting) => void
  updateConfig: (patch: Record<string, unknown>) => Promise<void>
  dismissOnboarding: () => void
}

export const useConfigStore = create<ConfigStore>((set) => ({
  hasApiKey: false,
  defaultModel: 'kling-v3',
  theme: 'auto',
  availableModels: [],
  updateAvailable: null,
  showOnboarding: false,

  loadConfig: async () => {
    try {
      const config = await api.getConfig()
      const theme = parseTheme(config.theme)
      set({
        hasApiKey: config.has_api_key,
        defaultModel: config.default_model,
        theme,
        availableModels: config.available_models,
        updateAvailable: config.update_available,
        showOnboarding: !config.has_api_key,
      })
      applyTheme(theme)
    } catch {
      applyTheme('auto')
    }
  },

  saveApiKey: async (key) => {
    await api.updateConfig({ fal_api_key: key })
    set({ hasApiKey: true, showOnboarding: false })
  },

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    api.updateConfig({ theme }).catch(() => {})
  },

  updateConfig: async (patch) => {
    const config = await api.updateConfig(patch)
    set({
      hasApiKey: config.has_api_key,
      defaultModel: config.default_model,
      theme: parseTheme(config.theme),
    })
  },

  dismissOnboarding: () => set({ showOnboarding: false }),
}))

// Listen for system theme changes when in auto mode
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useConfigStore.getState()
    if (theme === 'auto') {
      applyTheme('auto')
    }
  })
}
