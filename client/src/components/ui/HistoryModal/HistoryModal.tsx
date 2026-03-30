import { motion, AnimatePresence } from 'framer-motion'
import { X, Check, AlertCircle, Loader2, Download, Trash2, ExternalLink } from 'lucide-react'
import { useHistoryStore } from '@/store/historyStore'
import { useGenerationStore } from '@/store/generationStore'
import { ProgressBar } from '@/components/primitives/ProgressBar/ProgressBar'
import { formatRelativeTime } from '@/lib/formatters'

const modalVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, y: 8, transition: { duration: 0.15 } },
}

export function HistoryModal() {
  const isOpen = useHistoryStore((s) => s.isOpen)
  const items = useHistoryStore((s) => s.items)
  const closeModal = useHistoryStore((s) => s.closeModal)
  const deleteItem = useHistoryStore((s) => s.deleteItem)
  const openJob = useGenerationStore((s) => s.openJob)

  if (!isOpen) return null

  const handleOpenJob = (id: string) => {
    openJob(id)
    closeModal()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeModal}>
      <AnimatePresence>
        <motion.div
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
          className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              History
            </h2>
            <button onClick={closeModal} className="p-1" style={{ color: 'var(--text-tertiary)' }}>
              <X size={18} />
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-4">
            {items.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
                No generation history yet
              </p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl p-4"
                    style={{ backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {item.status === 'processing' && (
                          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
                        )}
                        {item.status === 'completed' && (
                          <Check size={16} style={{ color: 'var(--success)' }} />
                        )}
                        {item.status === 'failed' && (
                          <AlertCircle size={16} style={{ color: 'var(--danger)' }} />
                        )}
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {item.effect_name}
                        </span>
                      </div>
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>

                    <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {item.model_id}
                      {item.status === 'processing' && ` · ${item.progress_msg || 'Generating...'} ${item.progress}%`}
                    </p>

                    {item.status === 'processing' && (
                      <div className="mt-2 flex items-center gap-3">
                        <ProgressBar progress={item.progress} className="flex-1" />
                        <button
                          onClick={() => handleOpenJob(item.id)}
                          className="rounded-lg px-3 py-1 text-xs font-medium"
                          style={{ backgroundColor: 'var(--accent)', color: 'white' }}
                        >
                          Open
                        </button>
                      </div>
                    )}

                    {item.status === 'failed' && item.error && (
                      <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
                        {item.error}
                      </p>
                    )}

                    {item.status !== 'processing' && (
                      <div className="mt-2 flex justify-end gap-2">
                        {item.status === 'completed' && item.video_url && (
                          <a
                            href={item.video_url}
                            download
                            className="rounded-lg p-1.5"
                            style={{ color: 'var(--text-secondary)' }}
                            title="Download"
                          >
                            <Download size={14} />
                          </a>
                        )}
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="rounded-lg p-1.5 transition-colors"
                          style={{ color: 'var(--text-tertiary)' }}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
