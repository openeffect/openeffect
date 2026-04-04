import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, AlertCircle, Download, ArrowLeft, X, RotateCcw } from 'lucide-react'
import { useStore } from '@/store'
import { selectViewingJobId, selectJobs, selectViewingRunRecord } from '@/store/selectors/runSelectors'
import { selectSelectedEffect } from '@/store/selectors/effectsSelectors'
import { selectAvailableModels } from '@/store/selectors/configSelectors'
import { selectEditorIsOpen } from '@/store/selectors/editorSelectors'
import { closeJob } from '@/store/actions/runActions'
import { setState } from '@/store'
import { mutateSetRestoredParams, mutateClearViewingJob } from '@/store/mutations/runMutations'
import { navigate } from '@/utils/router'
import { mutateSetRightTab } from '@/store/mutations/effectsMutations'
import { Progress } from '@/components/ui/Progress'
import { VideoPlayer } from '@/components/VideoPlayer'
import { Button } from '@/components/ui/Button'

export function RunView() {
  const viewingJobId = useStore(selectViewingJobId)
  const activeJobs = useStore(selectJobs)
  const viewingRunRecord = useStore(selectViewingRunRecord)
  const selectedEffect = useStore(selectSelectedEffect)

  const activeJob = viewingJobId ? activeJobs.get(viewingJobId) : null

  // Historical run record view
  if (viewingRunRecord && !activeJob) {
    return <HistoricalRunView record={viewingRunRecord} hasEffect={!!selectedEffect} />
  }

  // Active job view
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
function HistoricalRunView({ record, hasEffect }: {
  record: import('@/types/api').RunRecord
  hasEffect: boolean
}) {
  const availableModels = useStore(selectAvailableModels)

  // Parse structured params
  const raw = typeof record.inputs === 'string'
    ? JSON.parse(record.inputs) as Record<string, unknown>
    : (record.inputs as Record<string, unknown> | null)

  const params = raw && 'inputs' in raw
    ? raw as { inputs: Record<string, string>; output?: Record<string, string | number>; user_params?: Record<string, unknown> }
    : { inputs: (raw ?? {}) as Record<string, string>, output: {}, user_params: {} }

  // Flatten all params into categorized lists
  const allEntries = {
    ...params.inputs,
    ...params.output,
    ...params.user_params,
  }
  const images: [string, string][] = []
  const longText: [string, string][] = []
  const badges: [string, string][] = []

  for (const [key, value] of Object.entries(allEntries)) {
    if (value == null || value === '') continue
    const strVal = String(value)
    const isImageRef = typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(value)
    if (isImageRef) {
      images.push([key, strVal])
    } else if (strVal.length > 50) {
      longText.push([key, strVal])
    } else {
      badges.push([key, strVal])
    }
  }

  const modelName = availableModels.find((m) => m.id === record.model_id)?.name ?? record.model_id
  if (modelName) badges.unshift(['model', modelName])

  const hasAnyParams = images.length > 0 || longText.length > 0 || badges.length > 0

  const handleReuse = () => {
    setState((s) => {
      mutateSetRestoredParams(s, {
        modelId: record.model_id ?? '',
        inputs: params.inputs,
        output: (params.output ?? {}) as Record<string, string | number>,
        userParams: params.user_params,
      })
      mutateSetRightTab(s, 'form')
    }, 'run/reuse')
  }

  const handleDownload = () => {
    if (!record.video_url) return
    const a = document.createElement('a')
    a.href = record.video_url
    a.download = `${record.effect_name.replace(/\s+/g, '-').toLowerCase()}.mp4`
    a.click()
  }

  const handleClose = () => {
    const selectedId = useStore.getState().effects.selectedId
    setState((s) => { mutateClearViewingJob(s) }, 'run/closeHistorical')
    if (selectedId) {
      navigate(`/effects/${selectedId}`)
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header — show model name + date instead of effect name (already on right panel) */}
      <div className="flex shrink-0 items-center gap-3 px-6 py-4">
        {record.status === 'completed' && <div className="h-2 w-2 rounded-full bg-success" />}
        {record.status === 'failed' && <div className="h-2 w-2 rounded-full bg-destructive" />}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground">
            {modelName}
          </span>
          <p className="text-[11px] text-muted-foreground">
            {new Date(record.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {record.video_url && (
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

      {/* Video */}
      {record.status === 'completed' && record.video_url && (
        <div className="flex flex-1 items-center justify-center p-6 pt-0">
          <div className="w-full max-w-3xl">
            <VideoPlayer src={record.video_url} autoPlay />
          </div>
        </div>
      )}

      {record.status === 'failed' && (
        <div className="flex flex-1 flex-col items-center justify-center p-12">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle size={32} className="text-destructive" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-foreground">Run failed</h2>
          <p className="max-w-md text-center text-sm text-secondary-foreground">
            {record.error || 'An unexpected error occurred'}
          </p>
        </div>
      )}

      {/* Parameters — compact layout */}
      {hasAnyParams && (
        <div className="shrink-0 border-t px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Parameters
            </h3>
            {hasEffect && (
              <Button variant="outline" size="sm" onClick={handleReuse} className="h-7 text-xs">
                <RotateCcw size={12} />
                Reuse
              </Button>
            )}
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
                {images.map(([key, refId]) => (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted">
                      <img
                        src={`/api/uploads/${refId}/512`}
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
