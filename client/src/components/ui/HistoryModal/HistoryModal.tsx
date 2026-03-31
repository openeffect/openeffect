import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, AlertCircle, Loader2, Download, Trash2 } from 'lucide-react'
import { useHistoryStore } from '@/store/historyStore'
import { ProgressBar } from '@/components/primitives/ProgressBar/ProgressBar'
import { formatRelativeTime } from '@/lib/formatters'

export function HistoryPopup() {
  const isOpen = useHistoryStore((s) => s.isOpen)
  const items = useHistoryStore((s) => s.items)
  const closeModal = useHistoryStore((s) => s.closeModal)
  const deleteItem = useHistoryStore((s) => s.deleteItem)
  const popupRef = useRef<HTMLDivElement>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        closeModal()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [isOpen, closeModal])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDeleteId) {
          setConfirmDeleteId(null)
        } else {
          closeModal()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, closeModal, confirmDeleteId])

  // Clear confirmation when popup closes
  useEffect(() => {
    if (!isOpen) setConfirmDeleteId(null)
  }, [isOpen])

  const handleOpen = (id: string) => {
    window.location.hash = `#generations/${id}`
    closeModal()
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
          className="absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-xl"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
          }}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              History
            </h3>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {items.length} generations
            </span>
          </div>

          <div className="max-h-[400px] overflow-y-auto p-2">
            {items.length === 0 ? (
              <p className="py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                No generations yet
              </p>
            ) : (
              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="cursor-pointer rounded-lg p-3 transition-colors"
                    style={{ background: 'var(--surface)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-elevated)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                    onClick={() => handleOpen(item.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {item.status === 'processing' && (
                          <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent)' }} />
                        )}
                        {item.status === 'completed' && (
                          <Check size={13} style={{ color: 'var(--success)' }} />
                        )}
                        {item.status === 'failed' && (
                          <AlertCircle size={13} style={{ color: 'var(--danger)' }} />
                        )}
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          {item.effect_name}
                        </span>
                      </div>
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>

                    {item.status === 'processing' && (
                      <div className="mt-1.5">
                        <ProgressBar progress={item.progress} />
                      </div>
                    )}

                    {item.status === 'failed' && item.error && (
                      <p className="mt-1 truncate text-[10px]" style={{ color: 'var(--danger)' }}>
                        {item.error}
                      </p>
                    )}

                    <div className="mt-1.5 flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {item.status === 'completed' && item.video_url && (
                        <a
                          href={item.video_url}
                          download
                          className="rounded p-1"
                          style={{ color: 'var(--text-tertiary)' }}
                          title="Download"
                        >
                          <Download size={12} />
                        </a>
                      )}
                      {item.status !== 'processing' && (
                        confirmDeleteId === item.id ? (
                          <>
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="rounded p-1"
                              style={{ color: 'var(--danger)' }}
                              title="Confirm delete"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded p-1"
                              style={{ color: 'var(--text-tertiary)' }}
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(item.id)}
                            className="rounded p-1"
                            style={{ color: 'var(--text-tertiary)' }}
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
