import { Sparkles, X, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { ProgressBar } from '@/components/primitives/ProgressBar/ProgressBar'
import { useGenerationStore } from '@/store/generationStore'

interface GenerationProgressProps {
  jobId: string
}

export function GenerationProgress({ jobId }: GenerationProgressProps) {
  const job = useGenerationStore((s) => s.activeJobs.get(jobId))
  const closeJob = useGenerationStore((s) => s.closeJob)

  if (!job) return null

  const isFailed = job.status === 'failed'

  return (
    <div className="flex h-full flex-col items-center justify-center p-12">
      <button
        onClick={closeJob}
        className="absolute right-4 top-4 rounded-lg p-2 transition-colors"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <X size={18} />
      </button>

      {isFailed ? (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex flex-col items-center gap-4 text-center"
        >
          <AlertCircle size={48} style={{ color: 'var(--danger)' }} />
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Generation failed
          </h3>
          <p className="max-w-md text-sm" style={{ color: 'var(--text-secondary)' }}>
            {job.error || 'An unexpected error occurred'}
          </p>
          <button
            onClick={closeJob}
            className="mt-4 rounded-lg px-6 py-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--surface-elevated)', color: 'var(--text-primary)' }}
          >
            Back to Gallery
          </button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex w-full max-w-md flex-col items-center gap-6 text-center"
        >
          <motion.div
            animate={{ rotate: [0, 180, 360] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
          >
            <Sparkles size={40} style={{ color: 'var(--accent)' }} />
          </motion.div>

          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Generating...
          </h3>

          <div className="w-full space-y-2">
            <ProgressBar progress={job.progress} />
            <div className="flex justify-between text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <span>{job.message || 'Processing...'}</span>
              <span className="tabular-nums">{job.progress}%</span>
            </div>
          </div>

          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {job.effectName}
          </p>
        </motion.div>
      )}
    </div>
  )
}
