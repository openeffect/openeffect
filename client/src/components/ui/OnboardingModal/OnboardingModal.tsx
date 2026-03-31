import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cloud, ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { useConfigStore } from '@/store/configStore'

export function OnboardingModal() {
  const [apiKey, setApiKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  const saveApiKey = useConfigStore((s) => s.saveApiKey)
  const dismissOnboarding = useConfigStore((s) => s.dismissOnboarding)

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    setSavingKey(true)
    try {
      await saveApiKey(apiKey.trim())
    } catch {
      alert('Failed to save API key')
    } finally {
      setSavingKey(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.25, ease: 'easeOut' } }}
          className="w-full max-w-md rounded-2xl p-7"
          style={{ background: 'var(--surface)', boxShadow: '0 24px 48px rgba(0,0,0,0.3)' }}
        >
          {/* Header */}
          <div className="mb-6 text-center">
            <div
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: 'var(--accent-dim)' }}
            >
              <Sparkles size={22} style={{ color: 'var(--accent)' }} />
            </div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Welcome to OpenEffect
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Open magic for your media
            </p>
          </div>

          <div className="space-y-3">
            {/* Cloud option */}
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <Cloud size={16} style={{ color: 'var(--accent)' }} />
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Cloud API (fal.ai)</h3>
              </div>
              <p className="mb-3 mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Fast &middot; ~$0.10-0.50 per video
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                  placeholder="Paste your fal.ai key..."
                  className="flex-1 rounded-lg px-3 py-2 text-sm outline-none placeholder:opacity-40"
                  style={{ background: 'var(--background)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
                <button
                  onClick={handleSaveKey}
                  disabled={!apiKey.trim() || savingKey}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}
                >
                  {savingKey ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                </button>
              </div>
              <a
                href="https://fal.ai/dashboard/keys"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                Get a free key <ExternalLink size={10} />
              </a>
            </div>

          </div>

          <button
            onClick={dismissOnboarding}
            className="mt-5 w-full text-center text-xs transition-colors hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Skip for now
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
