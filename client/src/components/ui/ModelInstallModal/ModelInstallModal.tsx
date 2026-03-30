import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Monitor } from 'lucide-react'
import { ProgressBar } from '@/components/primitives/ProgressBar/ProgressBar'
import { api } from '@/lib/api'

interface ModelInstallModalProps {
  isOpen: boolean
  onClose: () => void
  modelId: string
}

export function ModelInstallModal({ isOpen, onClose, modelId }: ModelInstallModalProps) {
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const handleInstall = async () => {
    setInstalling(true)
    setError(null)
    try {
      const { install_job_id } = await api.installModel(modelId)
      esRef.current?.close()
      const es = new EventSource(`/api/models/install/${install_job_id}/stream`)
      esRef.current = es

      es.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data)
        setProgress(data.progress)
        setMessage(data.message)
      })

      es.addEventListener('completed', () => {
        es.close()
        onClose()
      })

      es.addEventListener('failed', (e) => {
        const data = JSON.parse(e.data)
        es.close()
        setError(data.error)
        setInstalling(false)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Installation failed')
      setInstalling(false)
    }
  }

  useEffect(() => {
    return () => { esRef.current?.close() }
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-2xl p-6"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Monitor size={20} style={{ color: 'var(--accent)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Install Local Model
              </h2>
            </div>
            <button onClick={onClose} className="p-1" style={{ color: 'var(--text-tertiary)' }}>
              <X size={18} />
            </button>
          </div>

          {installing ? (
            <div className="space-y-3">
              <ProgressBar progress={progress} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {message || 'Installing...'}
              </p>
            </div>
          ) : (
            <>
              <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                This will download and install {modelId} locally (~7.1 GB). Requires a GPU with 8GB+ VRAM.
              </p>
              {error && (
                <p className="mb-4 text-sm" style={{ color: 'var(--danger)' }}>
                  {error}
                </p>
              )}
              <button
                onClick={handleInstall}
                className="w-full rounded-lg py-2.5 text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Start Installation
              </button>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
