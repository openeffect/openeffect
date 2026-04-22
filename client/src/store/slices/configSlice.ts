import type { ConfigSlice } from '../types'

export const initialConfigState: ConfigSlice = {
  hasApiKey: false,
  theme: 'auto',
  availableModels: [],
  updateAvailable: null,
  showOnboarding: false,
  // Optimistic default — the real value lands from `/api/config` on boot.
  // Treating keyring as available by default avoids flashing a scary banner
  // before the first response.
  keyringAvailable: true,
}
