import { useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { selectHistoryIsOpen, selectHistoryItems, selectHistoryTotal, selectHistoryStatus } from '@/store/selectors/historySelectors'
import { selectEffects } from '@/store/selectors/effectsSelectors'
import {
  closeHistory,
  deleteHistoryItem,
  openHistoryItem,
  loadHistory,
} from '@/store/actions/historyActions'
import { RunHistoryItem } from '@/components/RunHistoryItem'

export function HistoryPanel() {
  const isOpen = useStore(selectHistoryIsOpen)
  const items = useStore(selectHistoryItems)
  const total = useStore(selectHistoryTotal)
  const status = useStore(selectHistoryStatus)
  const effects = useStore(selectEffects)
  const popupRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        closeHistory()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeHistory()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen])

  // Lazy loading
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && items.length < total && status !== 'loading') {
        loadHistory(items.length)
      }
    },
    [items.length, total, status],
  )

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !isOpen) return
    const observer = new IntersectionObserver(handleIntersect, { threshold: 0.1 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [handleIntersect, isOpen])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={popupRef}
          initial={{ opacity: 0, y: -8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.96 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="absolute right-0 top-full z-50 mt-2 w-[480px] overflow-hidden rounded-xl border bg-card shadow-[0_12px_40px_rgba(0,0,0,0.3)]"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              History
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {items.length} runs
            </span>
          </div>

          <div className="max-h-[400px] overflow-y-auto p-2">
            {items.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No runs yet
              </p>
            ) : (
              <div className="space-y-1.5">
                {items.map((item) => {
                  const isOrphaned = !effects.some((e) => e.db_id === item.effect_id)
                  return (
                    <RunHistoryItem
                      key={item.id}
                      item={item}
                      effectName={isOrphaned ? 'Deleted effect' : item.effect_name}
                      isOrphaned={isOrphaned}
                      onClick={() => openHistoryItem({ id: item.id, effect_id: item.effect_id })}
                      onDelete={() => deleteHistoryItem(item.id)}
                    />
                  )
                })}

                {items.length < total && (
                  <div ref={sentinelRef} className="flex justify-center py-3">
                    {status === 'loading' && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
