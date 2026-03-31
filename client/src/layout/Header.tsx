import { RefreshCw, History, Settings, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useActiveJobCount, useGenerationStore } from '@/store/generationStore'
import { useHistoryStore } from '@/store/historyStore'
import { useConfigStore } from '@/store/configStore'
import { useEffectsStore } from '@/store/effectsStore'
import { HistoryPanel } from '@/features/history/HistoryPanel'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface HeaderProps {
  onSettingsOpen: () => void
}

export function Header({ onSettingsOpen }: HeaderProps) {
  const activeCount = useActiveJobCount()
  const restoringFromUrl = useGenerationStore((s) => s.restoringFromUrl)
  const openHistory = useHistoryStore((s) => s.open)
  const updateAvailable = useConfigStore((s) => s.updateAvailable)

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-5">
      {/* Logo */}
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); useEffectsStore.getState().selectEffect(null) }}
        className="flex items-center gap-2.5 no-underline hover:opacity-80"
      >
        <img src="/logo.png" alt="OpenEffect" className="h-8 w-8 rounded-lg" />
        <span className="text-base font-bold tracking-tight text-foreground">
          OpenEffect
        </span>
      </a>

      {/* Center: loading indicator or update banner */}
      <AnimatePresence mode="wait">
        {restoringFromUrl ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
          >
            <Loader2 size={18} className="animate-spin text-primary" />
          </motion.div>
        ) : updateAvailable ? (
          <motion.div
            key="update"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <Badge variant="accent" className="hidden px-3 py-1 text-xs sm:block">
              v{updateAvailable} available
            </Badge>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <AnimatePresence>
          {activeCount > 0 && (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={openHistory}
              className="mr-1 flex items-center gap-1.5 rounded-full bg-accent-dim px-2.5 py-1 text-xs font-semibold text-accent"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
              >
                <RefreshCw size={12} />
              </motion.div>
              {activeCount}
            </motion.button>
          )}
        </AnimatePresence>

        {/* History button + popup */}
        <div className="relative">
          <Button variant="ghost" size="icon" onClick={openHistory} title="History" className="bg-muted text-secondary-foreground">
            <History size={16} />
          </Button>
          <HistoryPanel />
        </div>

        <Button variant="ghost" size="icon" onClick={onSettingsOpen} title="Settings" className="bg-muted text-secondary-foreground">
          <Settings size={16} />
        </Button>
      </div>
    </header>
  )
}
