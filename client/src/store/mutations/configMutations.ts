import type { AppState, ConfigSlice } from '../types'

export function mutateSetConfig(s: AppState, patch: Partial<ConfigSlice>) {
  Object.assign(s.config, patch)
}

export function mutateDismissOnboarding(s: AppState) {
  s.config.showOnboarding = false
}
