import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cloud, ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { saveApiKey, dismissOnboarding } from '@/store/actions/configActions'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

export function OnboardingDialog() {
  const [apiKey, setApiKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-lg">
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.25, ease: 'easeOut' } }}
          className="w-full max-w-md rounded-2xl bg-card p-7 shadow-[0_24px_48px_rgba(0,0,0,0.3)]"
        >
          {/* Header */}
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-dim">
              <Sparkles size={22} className="text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">
              Welcome to OpenEffect
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open magic for your media
            </p>
          </div>

          <div className="space-y-3">
            {/* Cloud option */}
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <Cloud size={16} className="text-primary" />
                <h3 className="text-sm font-bold text-foreground">Cloud API (fal.ai)</h3>
              </div>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">
                Fast &middot; ~$0.10-0.50 per video
              </p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                  placeholder="Paste your fal.ai key..."
                  className="flex-1 bg-background"
                />
                <Button
                  onClick={handleSaveKey}
                  disabled={!apiKey.trim() || savingKey}
                >
                  {savingKey ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                </Button>
              </div>
              <a
                href="https://fal.ai/dashboard/keys"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Get a free key <ExternalLink size={10} />
              </a>
            </Card>
          </div>

          <button
            onClick={dismissOnboarding}
            className="mt-5 w-full text-center text-xs text-muted-foreground transition-colors hover:underline"
          >
            Skip for now
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
