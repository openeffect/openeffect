import { Sun, Moon } from 'lucide-react'
import { useConfigStore } from '@/store/configStore'

export function ThemeToggle() {
  const theme = useConfigStore((s) => s.theme)
  const setTheme = useConfigStore((s) => s.setTheme)

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:brightness-125"
      style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
