import { setState, getState } from '../index'
import { mutateSetConfig, mutateDismissOnboarding } from '../mutations/configMutations'
import { applyTheme, parseTheme, initSystemThemeListener } from '@/utils/theme'
import { api } from '@/utils/api'
import type { ThemeSetting } from '../types'

export async function loadConfig(): Promise<void> {
  try {
    const config = await api.getConfig()
    const theme = parseTheme(config.theme)
    setState((s) => {
      mutateSetConfig(s, {
        hasApiKey: config.has_api_key,
        defaultModel: config.default_model,
        theme,
        availableModels: config.available_models,
        updateAvailable: config.update_available,
        showOnboarding: !config.has_api_key,
      })
    }, 'config/load')
    applyTheme(theme)
  } catch {
    applyTheme('auto')
  }
}

export async function saveApiKey(key: string): Promise<void> {
  await api.updateConfig({ fal_api_key: key })
  setState((s) => {
    mutateSetConfig(s, { hasApiKey: true, showOnboarding: false })
  }, 'config/saveApiKey')
}

export function setTheme(theme: ThemeSetting): void {
  applyTheme(theme)
  setState((s) => {
    mutateSetConfig(s, { theme })
  }, 'config/setTheme')
  api.updateConfig({ theme }).catch(() => {})
}

export async function updateConfig(patch: Record<string, unknown>): Promise<void> {
  const config = await api.updateConfig(patch)
  setState((s) => {
    mutateSetConfig(s, {
      hasApiKey: config.has_api_key,
      defaultModel: config.default_model,
      theme: parseTheme(config.theme),
    })
  }, 'config/update')
}

export function dismissOnboarding(): void {
  setState((s) => {
    mutateDismissOnboarding(s)
  }, 'config/dismissOnboarding')
}

// Wire system theme listener (called once from initializeApp)
export function initThemeListener(): void {
  initSystemThemeListener(() => getState().config.theme)
}
