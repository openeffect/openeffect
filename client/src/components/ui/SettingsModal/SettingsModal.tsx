import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Eye, EyeOff } from 'lucide-react'
import { useConfigStore } from '@/store/configStore'

const modalVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, y: 8, transition: { duration: 0.15 } },
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const hasApiKey = useConfigStore((s) => s.hasApiKey)
  const theme = useConfigStore((s) => s.theme)
  const setTheme = useConfigStore((s) => s.setTheme)
  const updateConfig = useConfigStore((s) => s.updateConfig)

  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  if (!isOpen) return null

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    await updateConfig({ fal_api_key: apiKey.trim() })
    setApiKey('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <AnimatePresence>
        <motion.div
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-2xl p-6"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Settings
            </h2>
            <button onClick={onClose} className="p-1" style={{ color: 'var(--text-tertiary)' }}>
              <X size={18} />
            </button>
          </div>

          <div className="space-y-6">
            {/* API Key */}
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                fal.ai API Key
              </label>
              {hasApiKey && !apiKey && (
                <p className="text-xs" style={{ color: 'var(--success)' }}>
                  Key is set
                </p>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasApiKey ? 'Enter new key to update...' : 'Paste your fal.ai key...'}
                    className="w-full rounded-lg px-3 py-2 pr-10 text-sm outline-none"
                    style={{
                      backgroundColor: 'var(--surface-elevated)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                    }}
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button
                  onClick={handleSaveKey}
                  disabled={!apiKey.trim()}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  Save
                </button>
              </div>
            </div>

            {/* Theme */}
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Theme
              </label>
              <div className="flex gap-2">
                {(['auto', 'dark', 'light'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className="rounded-lg px-4 py-2 text-sm capitalize transition-colors"
                    style={{
                      backgroundColor: theme === t ? 'var(--accent)' : 'var(--surface-elevated)',
                      color: theme === t ? 'white' : 'var(--text-secondary)',
                    }}
                  >
                    {t === 'auto' ? 'System' : t}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
