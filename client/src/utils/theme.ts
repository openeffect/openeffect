import type { ThemeSetting } from '@/store/types'

export function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(setting: ThemeSetting) {
  const resolved = setting === 'auto' ? getSystemTheme() : setting
  document.documentElement.setAttribute('data-theme', resolved)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('theme', setting)
  }
}

export function parseTheme(value: unknown): ThemeSetting {
  if (value === 'dark' || value === 'light' || value === 'auto') return value
  return 'auto'
}

// Apply saved theme immediately - before React renders, prevents flash
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || saved === 'light' || saved === 'auto') {
    applyTheme(saved)
  }
}

// Listen for system theme changes when in auto mode
export function initSystemThemeListener(getTheme: () => ThemeSetting) {
  if (typeof window === 'undefined') return
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'auto') {
      applyTheme('auto')
    }
  })
}
