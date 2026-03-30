import type { EffectManifest } from '@/types/api'
import { api } from '@/lib/api'
import { ArrowDown, Plus } from 'lucide-react'

interface ExamplePreviewProps {
  manifest: EffectManifest
  effectId: string
}

export function ExamplePreview({ manifest, effectId }: ExamplePreviewProps) {
  const example = manifest.assets.example
  if (!example) return null

  const hasInput1 = example.input_1
  const hasInput2 = example.input_2
  const hasOutput = example.output

  if (!hasOutput && !hasInput1) return null

  // Output-only (text-to-video) — show large video
  if (!hasInput1 && hasOutput) {
    return (
      <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)' }}>
        <video
          src={api.getAssetUrl(effectId, example.output!)}
          autoPlay
          muted
          loop
          playsInline
          className="w-full"
          style={{ maxHeight: '280px', objectFit: 'cover' }}
        />
        <div className="px-3 py-2" style={{ background: 'var(--surface-elevated)' }}>
          <p className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>Example output</p>
        </div>
      </div>
    )
  }

  // Two inputs (image-transition) — side by side inputs, then arrow, then output
  if (hasInput1 && hasInput2 && hasOutput) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)' }}>
            <img
              src={api.getAssetUrl(effectId, example.input_1!)}
              alt="Start"
              className="aspect-square w-full object-cover"
            />
            <div className="px-3 py-1.5" style={{ background: 'var(--surface-elevated)' }}>
              <p className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>Start</p>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)' }}>
            <img
              src={api.getAssetUrl(effectId, example.input_2!)}
              alt="End"
              className="aspect-square w-full object-cover"
            />
            <div className="px-3 py-1.5" style={{ background: 'var(--surface-elevated)' }}>
              <p className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>End</p>
            </div>
          </div>
        </div>
        <div className="flex justify-center">
          <ArrowDown size={16} style={{ color: 'var(--text-tertiary)' }} />
        </div>
        <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)' }}>
          <video
            src={api.getAssetUrl(effectId, example.output!)}
            autoPlay
            muted
            loop
            playsInline
            className="w-full"
            style={{ maxHeight: '240px', objectFit: 'cover' }}
          />
          <div className="px-3 py-1.5" style={{ background: 'var(--surface-elevated)' }}>
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>Result</p>
          </div>
        </div>
      </div>
    )
  }

  // Single input + output — stacked vertically, full width
  return (
    <div className="space-y-2">
      {hasInput1 && (
        <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)' }}>
          <img
            src={api.getAssetUrl(effectId, example.input_1!)}
            alt="Example input"
            className="w-full"
            style={{ maxHeight: '200px', objectFit: 'cover' }}
          />
          <div className="px-3 py-1.5" style={{ background: 'var(--surface-elevated)' }}>
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>Input</p>
          </div>
        </div>
      )}
      {hasInput1 && hasOutput && (
        <div className="flex justify-center">
          <ArrowDown size={16} style={{ color: 'var(--text-tertiary)' }} />
        </div>
      )}
      {hasOutput && (
        <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)' }}>
          <video
            src={api.getAssetUrl(effectId, example.output!)}
            autoPlay
            muted
            loop
            playsInline
            className="w-full"
            style={{ maxHeight: '240px', objectFit: 'cover' }}
          />
          <div className="px-3 py-1.5" style={{ background: 'var(--surface-elevated)' }}>
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>Result</p>
          </div>
        </div>
      )}
    </div>
  )
}
