import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, AlertCircle, Download } from 'lucide-react'
import { useGenerationStore } from '@/store/generationStore'
import { ProgressBar } from '@/components/primitives/ProgressBar/ProgressBar'
import { VideoPlayer } from '@/components/primitives/VideoPlayer/VideoPlayer'

export function GenerationView() {
  const viewingJobId = useGenerationStore((s) => s.viewingJobId)
  const activeJobs = useGenerationStore((s) => s.activeJobs)

  const job = viewingJobId ? activeJobs.get(viewingJobId) : null
  if (!job) return null

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--background)' }}>
      <AnimatePresence mode="wait">
        {job.status === 'processing' && (
          <ProgressView key="progress" job={job} />
        )}
        {job.status === 'completed' && (
          <ResultView key="result" job={job} />
        )}
        {job.status === 'failed' && (
          <FailedView key="failed" job={job} />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Processing ─── */
function ProgressView({
  job,
}: {
  job: { effectName: string; progress: number; message: string | null }
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="relative flex flex-1 flex-col items-center justify-center p-12"
    >
      <motion.div
        animate={{ rotate: [0, 180, 360] }}
        transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
        className="mb-8"
      >
        <Sparkles size={44} style={{ color: 'var(--accent)' }} />
      </motion.div>

      <h2 className="mb-2 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
        Generating...
      </h2>
      <p className="mb-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>
        {job.effectName}
      </p>

      <div className="w-full max-w-md space-y-3">
        <ProgressBar progress={job.progress} />
        <div className="flex justify-between text-sm" style={{ color: 'var(--text-tertiary)' }}>
          <span>{job.message || 'Processing...'}</span>
          <span className="tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
            {job.progress}%
          </span>
        </div>
      </div>

      <p className="mt-10 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        You can close this and check progress in History
      </p>
    </motion.div>
  )
}

/* ─── Result ─── */
function ResultView({
  job,
}: {
  job: { effectName: string; videoUrl: string | null }
}) {
  const handleDownload = () => {
    if (!job.videoUrl) return
    const a = document.createElement('a')
    a.href = job.videoUrl
    a.download = `${job.effectName.replace(/\s+/g, '-').toLowerCase()}.mp4`
    a.click()
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="relative flex flex-1 flex-col"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-6 py-4">
        <div className="h-2 w-2 rounded-full" style={{ background: 'var(--success)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {job.effectName}
        </span>
        {job.videoUrl && (
          <button
            onClick={handleDownload}
            className="ml-auto flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white"
            style={{ background: 'var(--accent)', boxShadow: '0 2px 8px rgba(74,144,226,0.3)' }}
          >
            <Download size={14} />
            Download MP4
          </button>
        )}
      </div>

      {/* Video */}
      <div className="flex flex-1 items-center justify-center p-6 pt-0">
        <div className="w-full max-w-3xl">
          {job.videoUrl && <VideoPlayer src={job.videoUrl} autoPlay />}
        </div>
      </div>
    </motion.div>
  )
}

/* ─── Failed ─── */
function FailedView({
  job,
}: {
  job: { effectName: string; error: string | null }
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="relative flex flex-1 flex-col items-center justify-center p-12"
    >
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: 'rgba(224,77,77,0.1)' }}
      >
        <AlertCircle size={32} style={{ color: 'var(--danger)' }} />
      </div>

      <h2 className="mb-2 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
        Generation failed
      </h2>
      <p className="mb-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
        {job.effectName}
      </p>
      <p
        className="max-w-md text-center text-sm leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        {job.error || 'An unexpected error occurred'}
      </p>
    </motion.div>
  )
}
