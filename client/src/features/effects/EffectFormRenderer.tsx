import type { EffectManifest } from '@/types/api'
import { EffectFormField } from './EffectFormField'

interface EffectFormRendererProps {
  manifest: EffectManifest
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

export function EffectFormRenderer({ manifest, values, onChange }: EffectFormRendererProps) {
  // Separate inputs by role for smart layout
  const imageInputs = Object.entries(manifest.inputs ?? {}).filter(([_, s]) => s.type === 'image')
  const promptInputs = Object.entries(manifest.inputs ?? {}).filter(([_, s]) => s.type === 'text' && (s.role === 'prompt_input' || (!s.role)))
  const otherInputs = Object.entries(manifest.inputs ?? {}).filter(([_, s]) => s.type !== 'image' && !(s.type === 'text' && (s.role === 'prompt_input' || (!s.role))))

  return (
    <div className="space-y-5">
      {/* Image inputs - side by side if multiple */}
      {imageInputs.length > 1 ? (
        <div className="grid grid-cols-2 gap-3">
          {imageInputs.map(([key, schema]) => (
            <EffectFormField key={key} schema={schema} value={values[key]} onChange={(v) => onChange(key, v)} />
          ))}
        </div>
      ) : (
        imageInputs.map(([key, schema]) => (
          <EffectFormField key={key} schema={schema} value={values[key]} onChange={(v) => onChange(key, v)} />
        ))
      )}
      {/* Prompt inputs */}
      {promptInputs.map(([key, schema]) => (
        <EffectFormField key={key} schema={schema} value={values[key]} onChange={(v) => onChange(key, v)} />
      ))}
      {/* Other inputs */}
      {otherInputs.map(([key, schema]) => (
        <EffectFormField key={key} schema={schema} value={values[key]} onChange={(v) => onChange(key, v)} />
      ))}
    </div>
  )
}
