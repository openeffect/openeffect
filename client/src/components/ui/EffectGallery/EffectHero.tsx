import { motion } from 'framer-motion'
import { ArrowRight, Plus, Type } from 'lucide-react'
import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'

interface EffectHeroProps {
  effect: EffectManifest
}

export function EffectHero({ effect }: EffectHeroProps) {
  const fullId = `${effect.effect_type.replace(/_/g, '-')}/${effect.id}`

  const previewUrl = effect.assets.preview ? api.getAssetUrl(fullId, effect.assets.preview) : null
  const thumbnailUrl = api.getAssetUrl(fullId, effect.assets.thumbnail)
  const exampleOutputUrl = effect.assets.example?.output ? api.getAssetUrl(fullId, effect.assets.example.output) : null
  const input1Url = effect.assets.example?.input_1 ? api.getAssetUrl(fullId, effect.assets.example.input_1) : null
  const input2Url = effect.assets.example?.input_2 ? api.getAssetUrl(fullId, effect.assets.example.input_2) : null
  const videoSrc = previewUrl || exampleOutputUrl

  return (
    <div className="px-6 pb-2 pt-5">
      <HeroPreview
        key={`preview-${effect.id}`}
        effect={effect}
        videoSrc={videoSrc}
        thumbnailUrl={thumbnailUrl}
        input1Url={input1Url}
        input2Url={input2Url}
      />
    </div>
  )
}

/* ─── Media block ─── */
function MediaBlock({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.35, ease: [0.25, 1, 0.5, 1] }}
      className="relative flex-1 overflow-hidden rounded-xl"
      style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
    >
      {children}
    </motion.div>
  )
}

/* ─── Separators ─── */
function PipelinePlus({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.25, ease: 'easeOut' }}
      className="flex shrink-0 items-center justify-center"
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'var(--accent-dim)' }}>
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
      <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'var(--accent-dim)' }}>
        <ArrowRight size={14} style={{ color: 'var(--accent)' }} />
      </div>
    </motion.div>
  )
}

/* ─── Preview ─── */
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

/* ─── Pipeline blocks ─── */
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
        <video src={videoSrc} autoPlay muted loop playsInline preload="auto" className="h-full w-full object-cover" />
      ) : (
        <img src={thumbnailUrl} alt="Result" className="h-full w-full object-cover" />
      )}
    </MediaBlock>
  )

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

  if (effectType === 'text_to_video') {
    return (
      <>
        <MediaBlock delay={0.1}>
          <div className="flex h-full flex-col items-center justify-center gap-3 p-5" style={{ background: 'var(--surface)' }}>
            <Type size={28} style={{ color: 'var(--accent)', opacity: 0.5 }} />
            <p className="line-clamp-4 text-center text-xs italic leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              &ldquo;{promptPlaceholder}&rdquo;
            </p>
          </div>
        </MediaBlock>
        <PipelineArrow delay={0.2} />
        {resultBlock(0.25)}
      </>
    )
  }

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

function getPromptPlaceholder(effect: EffectManifest): string {
  const promptInput = Object.values(effect.inputs).find(
    (i) => i.type === 'text' && 'placeholder' in i && i.placeholder,
  )
  if (promptInput && 'placeholder' in promptInput && promptInput.placeholder) {
    return promptInput.placeholder.slice(0, 120)
  }
  return effect.description.slice(0, 100)
}
