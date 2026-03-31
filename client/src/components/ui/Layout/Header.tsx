import { RefreshCw, History, Settings, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGenerationStore } from '@/store/generationStore'
import { useHistoryStore } from '@/store/historyStore'
import { useConfigStore } from '@/store/configStore'
import { useEffectsStore } from '@/store/effectsStore'
import { HistoryPopup } from '@/components/ui/HistoryModal/HistoryModal'

interface HeaderProps {
  onSettingsOpen: () => void
}

export function Header({ onSettingsOpen }: HeaderProps) {
  const activeCount = useGenerationStore((s) => s.activeCount())
  const restoringFromUrl = useGenerationStore((s) => s.restoringFromUrl)
  const openHistory = useHistoryStore((s) => s.openModal)
  const updateAvailable = useConfigStore((s) => s.updateAvailable)

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between px-5"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
    >
      {/* Logo */}
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); useEffectsStore.getState().selectEffect(null) }}
        className="flex items-center gap-2.5 no-underline"
      >
        <img src="/logo.png" alt="OpenEffect" className="h-8 w-8 rounded-lg" />
        <span className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
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
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />
          </motion.div>
        ) : updateAvailable ? (
          <motion.div
            key="update"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="hidden rounded-full px-3 py-1 text-xs font-medium sm:block"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
          >
            v{updateAvailable} available
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
              className="mr-1 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
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
          <HeaderButton icon={<History size={16} />} onClick={openHistory} title="History" />
          <HistoryPopup />
        </div>

        <HeaderButton icon={<Settings size={16} />} onClick={onSettingsOpen} title="Settings" />
      </div>
    </header>
  )
}

function HeaderButton({ icon, onClick, title }: { icon: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
      style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
    >
      {icon}
    </button>
  )
}
