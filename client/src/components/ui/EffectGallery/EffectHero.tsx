import { motion } from 'framer-motion'
import { ArrowRight, Plus, Type } from 'lucide-react'
import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'

interface EffectHeroProps {
  effect: EffectManifest
}

export function EffectHero({ effect }: EffectHeroProps) {
  const fullId = `${effect.type}/${effect.id}`
  const outputUrl = effect.assets.output ? api.getAssetUrl(fullId, effect.assets.output) : null

  // Build input assets — match assets.inputs keys to manifest.inputs
  const inputBlocks: { key: string; type: string; assetUrl: string | null; assetText: string | null }[] = []
  for (const [key, schema] of Object.entries(effect.inputs)) {
    const assetValue = effect.assets.inputs?.[key]
    if (!assetValue) continue  // only show inputs that have an asset
    if (schema.type === 'image') {
      inputBlocks.push({ key, type: 'image', assetUrl: api.getAssetUrl(fullId, assetValue), assetText: null })
    } else if (schema.type === 'text') {
      inputBlocks.push({ key, type: 'text', assetUrl: null, assetText: assetValue })
    }
  }

  // Only show hero if there's at least one asset (input or output)
  if (inputBlocks.every((b) => !b.assetUrl && !b.assetText) && !outputUrl) return null

  return (
    <div className="px-6 pb-2 pt-5">
      <motion.div
        key={`preview-${effect.id}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2 } }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
      >
        <div className="flex items-stretch gap-3" style={{ height: 340 }}>
          {inputBlocks.map((block, i) => (
            <InputBlock key={block.key} block={block} delay={0.1 + i * 0.08} />
          ))}
          {inputBlocks.length > 0 && outputUrl && <PipelineArrow delay={0.1 + inputBlocks.length * 0.08} />}
          {outputUrl && (
            <MediaBlock delay={0.1 + inputBlocks.length * 0.08 + 0.05}>
              <video src={outputUrl} autoPlay muted loop playsInline preload="auto" className="h-full w-full object-cover" />
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
    </div>
  )
}

/* ─── Input block: renders image or text ─── */
function InputBlock({ block, delay }: { block: { type: string; assetUrl: string | null; assetText: string | null }; delay: number }) {
  if (block.type === 'image' && block.assetUrl) {
    return (
      <MediaBlock delay={delay}>
        <img src={block.assetUrl} alt="" className="h-full w-full object-cover" />
      </MediaBlock>
    )
  }

  if (block.type === 'text' && block.assetText) {
    return (
      <MediaBlock delay={delay}>
        <div className="flex h-full flex-col items-center justify-center gap-3 p-5" style={{ background: 'var(--surface)' }}>
          <Type size={28} style={{ color: 'var(--accent)', opacity: 0.5 }} />
          <p className="line-clamp-4 text-center text-xs italic leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            &ldquo;{block.assetText}&rdquo;
          </p>
        </div>
      </MediaBlock>
    )
  }

  return null
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

/* ─── Arrow ─── */
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
