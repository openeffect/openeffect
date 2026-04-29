import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, AlertCircle, Download, ArrowLeft, X, RotateCcw, FlaskConical, Save } from 'lucide-react'
import { useStore } from '@/store'
import { selectViewingJobId, selectJobs, selectViewingRunRecord } from '@/store/selectors/runSelectors'
import { selectSelectedEffect } from '@/store/selectors/effectsSelectors'
import { selectAvailableModels } from '@/store/selectors/configSelectors'
import { selectEditorIsOpen } from '@/store/selectors/editorSelectors'
import { closeJob, applyRunParams } from '@/store/actions/runActions'
import { openInPlayground } from '@/store/actions/playgroundActions'
import { createEffectFromRun } from '@/store/actions/editorActions'
import { setState } from '@/store'
import { mutateClearViewingJob } from '@/store/mutations/runMutations'
import { navigate } from '@/utils/router'
import { parseRunInputs } from '@/utils/runRecord'
import { runToPlaygroundParams } from '@/utils/playgroundSeed'
import { Progress } from '@/components/ui/Progress'
import { VideoPlayer } from '@/components/VideoPlayer'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import type { RunRecord } from '@/types/api'

export function RunView() {
  const viewingJobId = useStore(selectViewingJobId)
  const activeJobs = useStore(selectJobs)
  const viewingRunRecord = useStore(selectViewingRunRecord)

  const activeJob = viewingJobId ? activeJobs.get(viewingJobId) : null

  // Prefer the unified record view whenever we have the record — it has
  // the model, date, inputs, and parameters. activeJob (if present) feeds
  // live progress/video-url into it.
  if (viewingRunRecord) {
    return <HistoricalRunView record={viewingRunRecord} activeJob={activeJob ?? null} />
  }

  // Fallback: active job exists but we haven't fetched the record yet
  // (brief window between POST /run returning and the getRun response).
  if (!activeJob) return null

  return (
    <div className="flex h-full flex-col bg-background">
      <AnimatePresence mode="wait">
        {activeJob.status === 'processing' && (
          <ProgressView key="progress" job={activeJob} />
        )}
        {activeJob.status === 'completed' && (
          <ResultView key="result" job={activeJob} />
        )}
        {activeJob.status === 'failed' && (
          <FailedView key="failed" job={activeJob} />
        )}
      </AnimatePresence>
    </div>
  )
}

/* --- Historical run result --- */
function HistoricalRunView({ record, activeJob }: {
  record: RunRecord
  activeJob?: { progress: number; message: string | null; status: string; videoUrl: string | null; error: string | null } | null
}) {
  const availableModels = useStore(selectAvailableModels)
  const selectedEffect = useStore(selectSelectedEffect)
  const canReuse = record.kind === 'playground' || !!selectedEffect

  // Merge live state from activeJob over the static record so the unified
  // view shows a progress indicator mid-run and swaps to the final video /
  // error once SSE delivers the terminal event.
  const effectiveStatus = activeJob?.status ?? record.status
  const effectiveVideoUrl = activeJob?.videoUrl ?? record.output?.url ?? null
  const effectiveError = activeJob?.error ?? record.error
  const isProcessing = effectiveStatus === 'processing'
  const isCompleted = effectiveStatus === 'completed' && !!effectiveVideoUrl
  const isFailed = effectiveStatus === 'failed'

  const { inputs, params } = parseRunInputs(record)

  // Flatten non-image params into categorized display lists.
  // Image inputs are surfaced via `record.input_files` (server-resolved
  // FileRefs), not by UUID-pattern-matching the params blob.
  const allEntries = { ...inputs, ...params }
  const longText: [string, string][] = []
  const badges: [string, string][] = []

  for (const [key, value] of Object.entries(allEntries)) {
    if (value == null || value === '') continue
    const strVal = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
    if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(value)) {
      // Image-input UUID — rendered separately from `record.input_files`.
      continue
    }
    if (strVal.length > 50) {
      longText.push([key, strVal])
    } else {
      badges.push([key, strVal])
    }
  }
  const images = Object.entries(record.input_files ?? {})

  const modelName = availableModels.find((m) => m.id === record.model_id)?.name ?? record.model_id
  if (modelName) badges.unshift(['model', modelName])

  const hasAnyParams = images.length > 0 || longText.length > 0 || badges.length > 0

  const handleDownload = () => {
    if (!effectiveVideoUrl) return
    const a = document.createElement('a')
    a.href = effectiveVideoUrl
    const baseName = record.effect_name ?? record.kind ?? 'run'
    a.download = `${baseName.replace(/\s+/g, '-').toLowerCase()}.mp4`
    a.click()
  }

  const handleClose = () => {
    const state = useStore.getState()
    const selectedId = state.effects.selectedId
    const isPlayground = state.playground.isOpen
    setState((s) => { mutateClearViewingJob(s) }, 'run/closeHistorical')
    if (selectedId) {
      navigate(`/effects/${selectedId}`)
    } else if (isPlayground) {
      navigate('/playground')
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header — show model name + date instead of effect name (already on right panel) */}
      <div className="flex shrink-0 items-center gap-3 px-6 py-4">
        {isProcessing && <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />}
        {isCompleted && <div className="h-2 w-2 rounded-full bg-success" />}
        {isFailed && <div className="h-2 w-2 rounded-full bg-destructive" />}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground">
            {modelName}
          </span>
          <p className="text-[11px] text-muted-foreground">
            {new Date(record.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {record.kind === 'playground' && isCompleted && (
            <Button onClick={() => createEffectFromRun(record)} size="sm" variant="outline">
              <Save size={14} />
              Save as effect
            </Button>
          )}
          {isCompleted && effectiveVideoUrl && (
            <Button onClick={handleDownload} size="sm">
              <Download size={14} />
              Download MP4
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Video / progress / error slot */}
      {isProcessing && (
        <div className="flex flex-1 flex-col items-center justify-center p-12">
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
            {record.effect_name ?? modelName}
          </p>

          <div className="w-full max-w-md space-y-3">
            <Progress progress={activeJob?.progress ?? 0} />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{activeJob?.message || 'Processing...'}</span>
              <span className="tabular-nums font-semibold text-foreground">
                {activeJob?.progress ?? 0}%
              </span>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center gap-2">
            <BackToEditorButton />
            <p className="text-xs text-muted-foreground">
              You can close this and check progress in History
            </p>
          </div>
        </div>
      )}

      {isCompleted && effectiveVideoUrl && (
        <div className="flex flex-1 items-center justify-center p-6 pt-0">
          <div className="w-full max-w-3xl">
            <VideoPlayer src={effectiveVideoUrl} autoPlay />
          </div>
        </div>
      )}

      {isFailed && (
        <div className="flex flex-1 flex-col items-center justify-center p-12">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle size={32} className="text-destructive" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-foreground">Run failed</h2>
          <p className="max-w-md text-center text-sm text-secondary-foreground">
            {effectiveError || 'An unexpected error occurred'}
          </p>
        </div>
      )}

      {/* Parameters — compact layout */}
      {hasAnyParams && (
        <div className="shrink-0 border-t px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Parameters
            </h3>
            <div className="flex items-center gap-2">
              {record.kind === 'effect' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openInPlayground(runToPlaygroundParams(record))}
                  className="h-7 text-xs"
                >
                  <FlaskConical size={12} />
                  Open in playground
                </Button>
              )}
              {canReuse && (
                <Button variant="outline" size="sm" onClick={() => applyRunParams(record)} className="h-7 text-xs">
                  <RotateCcw size={12} />
                  Apply to form
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {/* Badges — short params in a compact wrapping row */}
            {badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {badges.map(([key, value]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 text-[11px]"
                  >
                    <span className="text-muted-foreground">{formatParamKey(key)}</span>
                    <span className="font-medium text-secondary-foreground">{value}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Images — inline thumbnails */}
            {images.length > 0 && (
              <div className="flex gap-2">
                {images.map(([key, ref]) => (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted">
                      <img
                        src={ref.thumbnails['512']}
                        alt={key}
                        className="h-full w-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground">{formatParamKey(key)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Long text — truncated with expand */}
            {longText.map(([key, value]) => (
              <ExpandableText key={key} label={formatParamKey(key)} text={value} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* --- Expandable long text param --- */
function ExpandableText({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = text.length > 80 ? text.slice(0, 80) + '...' : text

  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span className="text-secondary-foreground">
        {expanded ? text : truncated}
      </span>
      {text.length > 80 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-1 text-primary hover:underline"
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  )
}

function formatParamKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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
  // For playground runs, viewingRunRecord was set by the post-Generate
  // restoreFromUrl call — it has the full inputs we need to build an effect.
  const viewingRunRecord = useStore(selectViewingRunRecord)
  const canSaveAsEffect = viewingRunRecord?.kind === 'playground'

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
        {canSaveAsEffect && viewingRunRecord && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => createEffectFromRun(viewingRunRecord)}
          >
            <Save size={14} />
            Save as effect
          </Button>
        )}
        {job.videoUrl && (
          <Button
            onClick={handleDownload}
            className={cn('shadow-[0_2px_8px_rgba(74,144,226,0.3)]', !canSaveAsEffect && 'ml-auto')}
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
        Run failed
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
