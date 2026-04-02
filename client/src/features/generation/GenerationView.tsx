import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, AlertCircle, Download, ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { selectViewingJobId, selectJobs } from '@/store/selectors/generationSelectors'
import { selectEditorIsOpen } from '@/store/selectors/editorSelectors'
import { closeJob } from '@/store/actions/generationActions'
import { Progress } from '@/components/ui/Progress'
import { VideoPlayer } from '@/components/VideoPlayer'
import { Button } from '@/components/ui/Button'

export function GenerationView() {
  const viewingJobId = useStore(selectViewingJobId)
  const activeJobs = useStore(selectJobs)

  const job = viewingJobId ? activeJobs.get(viewingJobId) : null
  if (!job) return null

  return (
    <div className="flex h-full flex-col bg-background">
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

/* --- Processing --- */
function ProgressView({
  job,
}: {
  job: { effectName: string; progress: number; message: string | null }
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
      className="relative flex flex-1 flex-col items-center justify-center p-12"
    >
      <motion.div
        animate={{ rotate: [0, 180, 360] }}
        transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
        className="mb-8"
      >
        <Sparkles size={44} className="text-primary" />
      </motion.div>

      <h2 className="mb-2 text-xl font-bold text-foreground">
        Generating...
      </h2>
      <p className="mb-8 text-sm text-muted-foreground">
        {job.effectName}
      </p>

      <div className="w-full max-w-md space-y-3">
        <Progress progress={job.progress} />
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>{job.message || 'Processing...'}</span>
          <span className="tabular-nums font-semibold text-foreground">
            {job.progress}%
          </span>
        </div>
      </div>

      <div className="mt-10 flex flex-col items-center gap-2">
        <BackToEditorButton />
        <p className="text-xs text-muted-foreground">
          You can close this and check progress in History
        </p>
      </div>
    </motion.div>
  )
}

/* --- Result --- */
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
      className="relative flex flex-1 flex-col"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-6 py-4">
        <div className="h-2 w-2 rounded-full bg-success" />
        <span className="text-sm font-semibold text-foreground">
          {job.effectName}
        </span>
        {job.videoUrl && (
          <Button
            onClick={handleDownload}
            className="ml-auto shadow-[0_2px_8px_rgba(74,144,226,0.3)]"
            size="sm"
          >
            <Download size={14} />
            Download MP4
          </Button>
        )}
      </div>

      {/* Video */}
      <div className="flex flex-1 items-center justify-center p-6 pt-0">
        <div className="w-full max-w-3xl">
          {job.videoUrl && <VideoPlayer src={job.videoUrl} autoPlay />}
        </div>
      </div>
      <BackToEditorButton className="shrink-0 pb-4 text-center" />
    </motion.div>
  )
}

/* --- Failed --- */
function FailedView({
  job,
}: {
  job: { effectName: string; error: string | null }
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
      className="relative flex flex-1 flex-col items-center justify-center p-12"
    >
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle size={32} className="text-destructive" />
      </div>

      <h2 className="mb-2 text-xl font-bold text-foreground">
        Generation failed
      </h2>
      <p className="mb-2 text-sm text-muted-foreground">
        {job.effectName}
      </p>
      <p className="max-w-md text-center text-sm leading-relaxed text-secondary-foreground">
        {job.error || 'An unexpected error occurred'}
      </p>
      <BackToEditorButton className="mt-6" />
    </motion.div>
  )
}

/* --- Back to Editor --- */
function BackToEditorButton({ className }: { className?: string }) {
  const isEditorOpen = useStore(selectEditorIsOpen)
  if (!isEditorOpen) return null
  return (
    <div className={className}>
      <Button
        variant="outline"
        size="sm"
        onClick={closeJob}
      >
        <ArrowLeft size={14} />
        Back to Editor
      </Button>
    </div>
  )
}
