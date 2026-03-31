import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, X, AlertCircle, Loader2, Download, Trash2 } from 'lucide-react'
import { useHistoryStore } from '@/store/historyStore'
import { Progress } from '@/components/ui/progress'
import { formatRelativeTime } from '@/lib/formatters'

export function HistoryPanel() {
  const isOpen = useHistoryStore((s) => s.isOpen)
  const items = useHistoryStore((s) => s.items)
  const close = useHistoryStore((s) => s.close)
  const deleteItem = useHistoryStore((s) => s.deleteItem)
  const popupRef = useRef<HTMLDivElement>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        close()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [isOpen, close])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDeleteId) {
          setConfirmDeleteId(null)
        } else {
          close()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, close, confirmDeleteId])

  // Clear confirmation when popup closes
  useEffect(() => {
    if (!isOpen) setConfirmDeleteId(null)
  }, [isOpen])

  const handleOpen = (id: string) => {
    window.location.hash = `#generations/${id}`
    close()
  }

  const handleDelete = async (id: string) => {
    await deleteItem(id)
    setConfirmDeleteId(null)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={popupRef}
          initial={{ opacity: 0, y: -8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.96 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-xl border bg-card shadow-[0_12px_40px_rgba(0,0,0,0.3)]"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              History
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {items.length} generations
            </span>
          </div>

          <div className="max-h-[400px] overflow-y-auto p-2">
            {items.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No generations yet
              </p>
            ) : (
              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="cursor-pointer rounded-lg p-3 transition-colors hover:bg-muted"
                    onClick={() => handleOpen(item.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {item.status === 'processing' && (
                          <Loader2 size={13} className="animate-spin text-primary" />
                        )}
                        {item.status === 'completed' && (
                          <Check size={13} className="text-success" />
                        )}
                        {item.status === 'failed' && (
                          <AlertCircle size={13} className="text-destructive" />
                        )}
                        <span className="text-xs font-medium text-foreground">
                          {item.effect_name}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>

                    {item.status === 'processing' && (
                      <div className="mt-1.5">
                        <Progress progress={item.progress} />
                      </div>
                    )}

                    {item.status === 'failed' && item.error && (
                      <p className="mt-1 truncate text-[10px] text-destructive">
                        {item.error}
                      </p>
                    )}

                    <div className="mt-1.5 flex items-center justify-end gap-1.5">
                      {item.status === 'completed' && item.video_url && (
                        <a
                          href={item.video_url}
                          download
                          onClick={(e) => e.stopPropagation()}
                          title="Download"
                          className="rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                        >
                          <Download size={12} />
                        </a>
                      )}
                      {item.status !== 'processing' && (
                        confirmDeleteId === item.id ? (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}
                              className="rounded-lg p-1 text-destructive hover:bg-destructive/15 hover:text-destructive"
                              title="Confirm delete"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}
                              className="rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(item.id) }}
                            className="rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
