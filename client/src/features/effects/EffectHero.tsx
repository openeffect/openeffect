import { Fragment, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Plus, Type, Sparkles } from 'lucide-react'
import type { EffectManifest, FileRef, Showcase } from '@/types/api'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/utils/cn'

interface EffectHeroProps {
  effect: EffectManifest
}

function isFileRef(v: unknown): v is FileRef {
  return typeof v === 'object' && v !== null && 'kind' in v && 'url' in v
}

/** Hero is large (~340px). 1024.webp gives a sharp render at modest
 *  bandwidth; for video previews we still need the actual mp4 bytes. */
function heroSourceUrl(ref: FileRef): string {
  if (ref.kind === 'video') return ref.url
  return ref.thumbnails['1024'] ?? ref.url
}

export function EffectHero({ effect }: EffectHeroProps) {
  const [activeIdx, setActiveIdx] = useState(0)
  const showcases = effect.showcases
  const showcase: Showcase | null = showcases[activeIdx] ?? showcases[0] ?? null

  const previewRef = showcase?.preview ?? null
  const previewUrl = previewRef ? heroSourceUrl(previewRef) : null
  const previewIsVideo = previewRef?.kind === 'video'

  // Build input assets — match showcase.inputs keys to manifest.inputs
  const inputBlocks: { key: string; type: 'image' | 'text'; assetUrl: string | null; assetText: string | null }[] = []
  for (const [key, schema] of Object.entries(effect.inputs)) {
    const assetValue = showcase?.inputs?.[key]
    if (assetValue == null) continue
    if (schema.type === 'image' && isFileRef(assetValue)) {
      inputBlocks.push({ key, type: 'image', assetUrl: heroSourceUrl(assetValue), assetText: null })
    } else if (schema.type === 'text' && typeof assetValue === 'string') {
      inputBlocks.push({ key, type: 'text', assetUrl: null, assetText: assetValue })
    }
  }

  // Skip hero entirely if nothing to show in any showcase
  if (!previewUrl && inputBlocks.length === 0) return null

  return (
    <div className="pb-2 pt-5">
      <motion.div
        key={`preview-${effect.id}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2 } }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
      >
        <div className="flex items-center gap-3">
          {showcases.length > 1 && (
            <ShowcaseColumn
              showcases={showcases}
              activeIdx={activeIdx}
              onSelect={setActiveIdx}
            />
          )}
          <div className="min-w-0 flex-1 overflow-x-auto py-1">
            <div className="mx-auto flex w-max items-center gap-3 px-6">
              {inputBlocks.map((block, i) => (
                <Fragment key={block.key}>
                  {i > 0 && <PipelineGlyph delay={0.1 + i * 0.08 - 0.04} icon="plus" />}
                  <InputBlock block={block} delay={0.1 + i * 0.08} />
                </Fragment>
              ))}
              {inputBlocks.length > 0 && previewUrl && <PipelineGlyph delay={0.1 + inputBlocks.length * 0.08} icon="arrow" />}
              {previewUrl && (
                <MediaBlock delay={0.1 + inputBlocks.length * 0.08 + 0.05}>
                  {previewIsVideo ? (
                    <video src={previewUrl} autoPlay muted loop playsInline preload="auto" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  ) : (
                    <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  )}
                </MediaBlock>
              )}
            </div>
          </div>
        </div>

        {effect.tags.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.25 }}
            className="mt-3 flex flex-wrap justify-center gap-1.5 px-6"
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

/* --- Showcase picker: vertical column to the left of the pipeline.
       Height is capped to the MediaBlock height (340px) so it aligns with
       the preview tile and scrolls internally when an effect ships many
       showcases. --- */
function ShowcaseColumn({
  showcases,
  activeIdx,
  onSelect,
}: {
  showcases: Showcase[]
  activeIdx: number
  onSelect: (idx: number) => void
}) {
  return (
    <motion.aside
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1, duration: 0.25 }}
      className="flex max-h-[340px] shrink-0 flex-col items-center gap-2 self-center overflow-y-auto py-1 pl-6 pr-1"
    >
      {showcases.map((sc, i) => (
        <ShowcaseThumb
          key={i}
          showcase={sc}
          isActive={i === activeIdx}
          onClick={() => onSelect(i)}
        />
      ))}
    </motion.aside>
  )
}

function ShowcaseThumb({
  showcase,
  isActive,
  onClick,
}: {
  showcase: Showcase
  isActive: boolean
  onClick: () => void
}) {
  const preview = showcase.preview ?? null
  // 12×12 button → 512.webp is overkill but the smallest tier we have.
  const thumbUrl = preview
    ? (preview.kind === 'video' ? preview.thumbnails['512'] : preview.thumbnails['512'] ?? preview.url)
    : null
  const isVideo = preview?.kind === 'video'
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 bg-muted transition-all',
        isActive
          ? 'border-primary'
          : 'border-transparent opacity-70 hover:border-border hover:opacity-100',
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <Sparkles size={14} className="text-muted-foreground opacity-40" />
      </div>
      {thumbUrl && (isVideo ? (
        // Even for video previews the thumb is a poster frame (.webp),
        // so render it as an img — no need to spin up a <video> element
        // for a 48px tile.
        <img
          src={thumbUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      ) : (
        <img
          src={thumbUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      ))}
    </button>
  )
}

/* --- Input block: renders image or text --- */
function InputBlock({ block, delay }: { block: { type: 'image' | 'text'; assetUrl: string | null; assetText: string | null }; delay: number }) {
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
          <Type size={24} className="shrink-0 text-primary opacity-50" />
          <p className="line-clamp-[10] overflow-hidden text-center text-xs italic leading-relaxed text-muted-foreground">
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
      className="relative h-[340px] w-[340px] shrink-0 overflow-hidden rounded-xl border bg-muted shadow-sm"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <Sparkles size={24} className="text-muted-foreground opacity-30" />
      </div>
      <div className="absolute inset-0">
        {children}
      </div>
    </motion.div>
  )
}

/* --- Pipeline glyph (plus between inputs, arrow before the result) --- */
function PipelineGlyph({ delay = 0, icon }: { delay?: number; icon: 'plus' | 'arrow' }) {
  const Icon = icon === 'plus' ? Plus : ArrowRight
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.25, ease: 'easeOut' }}
      className="flex shrink-0 items-center justify-center"
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-dim">
        <Icon size={14} className="text-primary" />
      </div>
    </motion.div>
  )
}
