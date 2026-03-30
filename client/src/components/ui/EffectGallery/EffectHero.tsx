import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, AlertCircle, Download, ArrowRight, Plus, Type } from 'lucide-react'
import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'
import { useGenerationStore } from '@/store/generationStore'
import { ProgressBar } from '@/components/primitives/ProgressBar/ProgressBar'
import { VideoPlayer } from '@/components/primitives/VideoPlayer/VideoPlayer'
import { formatEffectType } from '@/lib/formatters'

interface EffectHeroProps {
  effect: EffectManifest
}

type HeroMode = 'preview' | 'progress' | 'result' | 'failed'

export function EffectHero({ effect }: EffectHeroProps) {
  const viewingJobId = useGenerationStore((s) => s.viewingJobId)
  const activeJobs = useGenerationStore((s) => s.activeJobs)
  const closeJob = useGenerationStore((s) => s.closeJob)

  const fullId = `${effect.effect_type.replace(/_/g, '-')}/${effect.id}`

  const job = viewingJobId ? activeJobs.get(viewingJobId) : null
  let mode: HeroMode = 'preview'
  if (job) {
    if (job.status === 'processing') mode = 'progress'
    else if (job.status === 'completed') mode = 'result'
    else if (job.status === 'failed') mode = 'failed'
  }

  const previewUrl = effect.assets.preview ? api.getAssetUrl(fullId, effect.assets.preview) : null
  const thumbnailUrl = api.getAssetUrl(fullId, effect.assets.thumbnail)
  const exampleOutputUrl = effect.assets.example?.output ? api.getAssetUrl(fullId, effect.assets.example.output) : null
  const input1Url = effect.assets.example?.input_1 ? api.getAssetUrl(fullId, effect.assets.example.input_1) : null
  const input2Url = effect.assets.example?.input_2 ? api.getAssetUrl(fullId, effect.assets.example.input_2) : null
  const videoSrc = previewUrl || exampleOutputUrl

  return (
    <div className="px-6 pb-2 pt-5">
      <AnimatePresence mode="wait">
        {mode === 'preview' && (
          <HeroPreview
            key={`preview-${effect.id}`}
            effect={effect}
            videoSrc={videoSrc}
            thumbnailUrl={thumbnailUrl}
            input1Url={input1Url}
            input2Url={input2Url}
          />
        )}
        {mode === 'progress' && job && (
          <HeroProgress key="progress" job={job} onClose={closeJob} />
        )}
        {mode === 'result' && job && (
          <HeroResult key="result" job={job} onClose={closeJob} />
        )}
        {mode === 'failed' && job && (
          <HeroFailed key="failed" job={job} onClose={closeJob} />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Media block — shared rounded block for images/videos ─── */
function MediaBlock({
  children,
  delay = 0,
}: {
  children: React.ReactNode
  delay?: number
}) {
  return (
    <motion.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.35, ease: [0.25, 1, 0.5, 1] }}
      className="relative flex-1 overflow-hidden rounded-xl"
      style={{
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {children}
    </motion.div>
  )
}

/* ─── Separator icons ─── */
function PipelinePlus({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.25, ease: 'easeOut' }}
      className="flex shrink-0 items-center justify-center"
    >
      <div
        className="flex h-7 w-7 items-center justify-center rounded-full"
        style={{ background: 'var(--accent-dim)' }}
      >
        <Plus size={14} style={{ color: 'var(--accent)' }} />
      </div>
    </motion.div>
  )
}

function PipelineArrow({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.25, ease: 'easeOut' }}
      className="flex shrink-0 items-center justify-center"
    >
      <div
        className="flex h-7 w-7 items-center justify-center rounded-full"
        style={{ background: 'var(--accent-dim)' }}
      >
        <ArrowRight size={14} style={{ color: 'var(--accent)' }} />
      </div>
    </motion.div>
  )
}

/* ─── Preview mode ─── */
function HeroPreview({
  effect,
  videoSrc,
  thumbnailUrl,
  input1Url,
  input2Url,
}: {
  effect: EffectManifest
  videoSrc: string | null
  thumbnailUrl: string
  input1Url: string | null
  input2Url: string | null
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2 } }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
    >
      {/* Title row */}
      <motion.div
        initial={{ y: 6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05, duration: 0.25 }}
        className="mb-4 flex items-center gap-2.5"
      >
        <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
          {effect.name}
        </h2>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >
          {formatEffectType(effect.effect_type)}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          &mdash; {effect.description.length > 70 ? effect.description.slice(0, 70) + '...' : effect.description}
        </span>
      </motion.div>

      {/* Pipeline blocks */}
      <div className="flex items-stretch gap-3" style={{ height: 340 }}>
        <PipelineBlocks
          effectType={effect.effect_type}
          videoSrc={videoSrc}
          thumbnailUrl={thumbnailUrl}
          input1Url={input1Url}
          input2Url={input2Url}
          promptPlaceholder={getPromptPlaceholder(effect)}
        />
      </div>

      {/* Tags */}
      {effect.tags.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.25 }}
          className="mt-3 flex flex-wrap gap-1.5"
        >
          {effect.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ background: 'var(--surface-elevated)', color: 'var(--text-tertiary)' }}
            >
              {tag}
            </span>
          ))}
        </motion.div>
      )}
    </motion.div>
  )
}

/* ─── Pipeline blocks — adapts to effect type ─── */
function PipelineBlocks({
  effectType,
  videoSrc,
  thumbnailUrl,
  input1Url,
  input2Url,
  promptPlaceholder,
}: {
  effectType: string
  videoSrc: string | null
  thumbnailUrl: string
  input1Url: string | null
  input2Url: string | null
  promptPlaceholder: string
}) {
  const resultBlock = (delay: number) => (
    <MediaBlock delay={delay}>
      {videoSrc ? (
        <video
          src={videoSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="h-full w-full object-cover"
        />
      ) : (
        <img src={thumbnailUrl} alt="Result" className="h-full w-full object-cover" />
      )}
    </MediaBlock>
  )

  // image_transition: [img1] + [img2] → [result]
  if (effectType === 'image_transition') {
    return (
      <>
        <MediaBlock delay={0.1}>
          <img src={input1Url || thumbnailUrl} alt="" className="h-full w-full object-cover" />
        </MediaBlock>
        <PipelinePlus delay={0.18} />
        <MediaBlock delay={0.2}>
          <img src={input2Url || thumbnailUrl} alt="" className="h-full w-full object-cover" />
        </MediaBlock>
        <PipelineArrow delay={0.28} />
        {resultBlock(0.3)}
      </>
    )
  }

  // text_to_video: [prompt] → [result]
  if (effectType === 'text_to_video') {
    return (
      <>
        <MediaBlock delay={0.1}>
          <div
            className="flex h-full flex-col items-center justify-center gap-3 p-5"
            style={{ background: 'var(--surface)' }}
          >
            <Type size={28} style={{ color: 'var(--accent)', opacity: 0.5 }} />
            <p
              className="line-clamp-4 text-center text-xs italic leading-relaxed"
              style={{ color: 'var(--text-tertiary)' }}
            >
              &ldquo;{promptPlaceholder}&rdquo;
            </p>
          </div>
        </MediaBlock>
        <PipelineArrow delay={0.2} />
        {resultBlock(0.25)}
      </>
    )
  }

  // single_image / image_loop: [image] → [result]
  return (
    <>
      <MediaBlock delay={0.1}>
        <img src={input1Url || thumbnailUrl} alt="" className="h-full w-full object-cover" />
      </MediaBlock>
      <PipelineArrow delay={0.2} />
      {resultBlock(0.25)}
    </>
  )
}

/* ─── Helper ─── */
function getPromptPlaceholder(effect: EffectManifest): string {
  const promptInput = Object.values(effect.inputs).find(
    (i) => i.type === 'text' && 'placeholder' in i && i.placeholder,
  )
  if (promptInput && 'placeholder' in promptInput && promptInput.placeholder) {
    return promptInput.placeholder.slice(0, 120)
  }
  return effect.description.slice(0, 100)
}

/* ─── Progress ─── */
function HeroProgress({
  job,
  onClose,
}: {
  job: { effectName: string; progress: number; message: string | null }
  onClose: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className="relative flex flex-col items-center justify-center rounded-2xl py-16"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition-all hover:brightness-125"
        style={{ background: 'var(--surface-elevated)', color: 'var(--text-tertiary)' }}
      >
        <X size={16} />
      </button>

      <motion.div
        animate={{ rotate: [0, 180, 360] }}
        transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
        className="mb-5"
      >
        <Sparkles size={32} style={{ color: 'var(--accent)' }} />
      </motion.div>

      <h3 className="mb-1 text-base font-bold" style={{ color: 'var(--text-primary)' }}>Generating...</h3>
      <p className="mb-5 text-sm" style={{ color: 'var(--text-tertiary)' }}>{job.effectName}</p>

      <div className="w-full max-w-xs space-y-2 px-6">
        <ProgressBar progress={job.progress} />
        <div className="flex justify-between text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <span>{job.message || 'Processing...'}</span>
          <span className="tabular-nums font-medium">{job.progress}%</span>
        </div>
      </div>
    </motion.div>
  )
}

/* ─── Result ─── */
function HeroResult({
  job,
  onClose,
}: {
  job: { effectName: string; videoUrl: string | null }
  onClose: () => void
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
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className="overflow-hidden rounded-2xl"
      style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
    >
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ background: 'var(--success)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{job.effectName}</span>
        </div>
        <div className="flex items-center gap-2">
          {job.videoUrl && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: 'var(--accent)' }}
            >
              <Download size={13} /> Download
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-all hover:brightness-125"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-tertiary)' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="p-3">
        {job.videoUrl && <VideoPlayer src={job.videoUrl} autoPlay />}
      </div>
    </motion.div>
  )
}

/* ─── Failed ─── */
function HeroFailed({
  job,
  onClose,
}: {
  job: { effectName: string; error: string | null }
  onClose: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className="relative flex flex-col items-center justify-center rounded-2xl py-16"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition-all hover:brightness-125"
        style={{ background: 'var(--surface-elevated)', color: 'var(--text-tertiary)' }}
      >
        <X size={16} />
      </button>

      <AlertCircle size={36} className="mb-4" style={{ color: 'var(--danger)' }} />
      <h3 className="mb-1 text-base font-bold" style={{ color: 'var(--text-primary)' }}>Generation failed</h3>
      <p className="mb-5 max-w-sm text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        {job.error || 'An unexpected error occurred'}
      </p>
      <button
        onClick={onClose}
        className="rounded-lg px-5 py-2 text-sm font-medium transition-colors hover:brightness-110"
        style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}
      >
        Back to Gallery
      </button>
    </motion.div>
  )
}
