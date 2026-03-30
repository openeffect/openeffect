import { RefreshCw, History, Settings } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThemeToggle } from '@/components/primitives/ThemeToggle/ThemeToggle'
import { useGenerationStore } from '@/store/generationStore'
import { useHistoryStore } from '@/store/historyStore'
import { useConfigStore } from '@/store/configStore'

interface HeaderProps {
  onSettingsOpen: () => void
}

export function Header({ onSettingsOpen }: HeaderProps) {
  const activeCount = useGenerationStore((s) => s.activeCount())
  const openHistory = useHistoryStore((s) => s.openModal)
  const updateAvailable = useConfigStore((s) => s.updateAvailable)

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between px-5"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <img src="/logo.png" alt="OpenEffect" className="h-8 w-8 rounded-lg" />
        <span className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          OpenEffect
        </span>
      </div>

      {/* Update banner */}
      <AnimatePresence>
        {updateAvailable && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="hidden rounded-full px-3 py-1 text-xs font-medium sm:block"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
          >
            v{updateAvailable} available
          </motion.div>
        )}
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

        <HeaderButton icon={<History size={16} />} onClick={openHistory} title="History" />
        <HeaderButton icon={<Settings size={16} />} onClick={onSettingsOpen} title="Settings" />
        <ThemeToggle />
      </div>
    </header>
  )
}

function HeaderButton({ icon, onClick, title }: { icon: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:brightness-125"
      style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
    >
      {icon}
    </button>
  )
}
