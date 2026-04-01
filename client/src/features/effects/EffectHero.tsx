import { motion } from 'framer-motion'
import { ArrowRight, Type, Sparkles } from 'lucide-react'
import type { EffectManifest } from '@/types/api'
import { isVideoUrl } from '@/lib/formatters'
import { Badge } from '@/components/ui/badge'

interface EffectHeroProps {
  effect: EffectManifest
}

export function EffectHero({ effect }: EffectHeroProps) {
  const previewUrl = effect.assets.preview ?? null

  // Build input assets — match assets.inputs keys to manifest.inputs
  const inputBlocks: { key: string; type: string; assetUrl: string | null; assetText: string | null }[] = []
  for (const [key, schema] of Object.entries(effect.inputs)) {
    const assetValue = effect.assets.inputs?.[key]
    if (!assetValue) continue
    if (schema.type === 'image') {
      inputBlocks.push({ key, type: 'image', assetUrl: assetValue, assetText: null })
    } else if (schema.type === 'text') {
      inputBlocks.push({ key, type: 'text', assetUrl: null, assetText: assetValue })
    }
  }

  // Skip hero entirely if no assets at all
  if (!previewUrl && inputBlocks.length === 0) return null

  return (
    <div className="px-6 pb-2 pt-5">
      <motion.div
        key={`preview-${effect.id}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2 } }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
      >
        <div className="flex h-[340px] items-stretch gap-3">
          {inputBlocks.map((block, i) => (
            <InputBlock key={block.key} block={block} delay={0.1 + i * 0.08} />
          ))}
          {inputBlocks.length > 0 && previewUrl && <PipelineArrow delay={0.1 + inputBlocks.length * 0.08} />}
          {previewUrl && (
            <MediaBlock delay={0.1 + inputBlocks.length * 0.08 + 0.05}>
              {isVideoUrl(previewUrl) ? (
                <video src={previewUrl} autoPlay muted loop playsInline preload="auto" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              ) : (
                <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              )}
            </MediaBlock>
          )}
        </div>

        {effect.tags.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.25 }}
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {effect.tags.map((tag) => (
              <Badge key={tag}>
                {tag}
              </Badge>
            ))}
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}

/* --- Input block: renders image or text --- */
function InputBlock({ block, delay }: { block: { type: string; assetUrl: string | null; assetText: string | null }; delay: number }) {
  if (block.type === 'image' && block.assetUrl) {
    return (
      <MediaBlock delay={delay}>
        <img src={block.assetUrl} alt="" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
      </MediaBlock>
    )
  }

  if (block.type === 'text' && block.assetText) {
    return (
      <MediaBlock delay={delay}>
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-card p-5">
          <Type size={28} className="text-primary opacity-50" />
          <p className="line-clamp-4 text-center text-xs italic leading-relaxed text-muted-foreground">
            &ldquo;{block.assetText}&rdquo;
          </p>
        </div>
      </MediaBlock>
    )
  }

  return null
}

/* --- Media block --- */
function MediaBlock({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.35, ease: [0.25, 1, 0.5, 1] }}
      className="relative flex-1 overflow-hidden rounded-xl border bg-muted shadow-sm"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <Sparkles size={24} className="text-muted-foreground opacity-30" />
      </div>
      {children}
    </motion.div>
  )
}

/* --- Arrow --- */
function PipelineArrow({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.25, ease: 'easeOut' }}
      className="flex shrink-0 items-center justify-center"
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-dim">
        <ArrowRight size={14} className="text-primary" />
      </div>
    </motion.div>
  )
}
