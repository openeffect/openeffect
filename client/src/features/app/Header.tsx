import { RefreshCw, History, Package, Settings, Loader2, Plus, FlaskConical } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@/store'
import { selectActiveJobCount, selectRestoringFromUrl } from '@/store/selectors/runSelectors'
import { selectIsForking } from '@/store/selectors/editorSelectors'
import { selectUpdateAvailable } from '@/store/selectors/configSelectors'
import { openHistory } from '@/store/actions/historyActions'
import { openBlankEditor } from '@/store/actions/editorActions'
import { openPlayground } from '@/store/actions/playgroundActions'
import { goHome } from '@/store/actions/appActions'
import { HistoryPanel } from '@/features/history/HistoryPanel'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

interface HeaderProps {
  onEffectsOpen: () => void
  onSettingsOpen: () => void
}

export function Header({ onEffectsOpen, onSettingsOpen }: HeaderProps) {
  const activeCount = useStore(selectActiveJobCount)
  const restoringFromUrl = useStore(selectRestoringFromUrl)
  const isForking = useStore(selectIsForking)
  const updateAvailable = useStore(selectUpdateAvailable)
  const isLoading = restoringFromUrl || isForking

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-5">
      {/* Logo */}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault()
          goHome()
        }}
        className="flex items-center gap-2.5 no-underline hover:opacity-80"
      >
        <img src="/logo.png" alt="OpenEffect" className="h-8 w-8 rounded-lg" />
        <span className="text-base font-bold tracking-tight text-foreground">
          OpenEffect
        </span>
      </a>

      {/* Center: loading indicator or update banner */}
      <AnimatePresence mode="wait">
        {isLoading ? (
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
        {/* Group 1: daily-use (do stuff + review) */}
        <Button variant="ghost" size="icon" onClick={() => openPlayground()} title="Playground" className="bg-muted text-secondary-foreground">
          <FlaskConical size={16} />
        </Button>

        {/* History button + popup */}
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={openHistory}
            title="History"
            className={activeCount > 0
              ? 'relative bg-primary/15 text-primary ring-1 ring-primary/30'
              : 'bg-muted text-secondary-foreground'
            }
          >
            {activeCount > 0 ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
              >
                <RefreshCw size={16} />
              </motion.div>
            ) : (
              <History size={16} />
            )}
            {activeCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
                {activeCount}
              </span>
            )}
          </Button>
          <HistoryPanel />
        </div>

        <div className="mx-1.5 h-5 w-px bg-border" aria-hidden />

        {/* Group 2: author + manage library */}
        <Button variant="ghost" size="icon" onClick={() => openBlankEditor()} title="Create Effect" className="bg-muted text-secondary-foreground">
          <Plus size={16} />
        </Button>

        <Button variant="ghost" size="icon" onClick={onEffectsOpen} title="Effects" className="bg-muted text-secondary-foreground">
          <Package size={16} />
        </Button>

        <div className="mx-1.5 h-5 w-px bg-border" aria-hidden />

        {/* Group 3: app config */}
        <Button variant="ghost" size="icon" onClick={onSettingsOpen} title="Settings" className="bg-muted text-secondary-foreground">
          <Settings size={16} />
        </Button>
      </div>
    </header>
  )
}
