import type { EffectManifest } from '@/types/api'
import { EffectFormField } from './EffectFormField'

interface EffectFormRendererProps {
  manifest: EffectManifest
  values: Record<string, unknown>
  errors?: Record<string, string | null>
  onChange: (key: string, value: unknown) => void
}

export function EffectFormRenderer({ manifest, values, errors, onChange }: EffectFormRendererProps) {
  // Separate inputs by role for smart layout, skip advanced inputs
  const nonAdvanced = Object.entries(manifest.inputs ?? {}).filter(([_, s]) => !s.advanced)
  const imageInputs = nonAdvanced.filter(([_, s]) => s.type === 'image')
  const promptInputs = nonAdvanced.filter(([_, s]) => s.type === 'text')
  const otherInputs = nonAdvanced.filter(([_, s]) => s.type !== 'image' && s.type !== 'text')

  const renderField = (key: string, schema: typeof nonAdvanced[number][1]) => (
    <div key={key} data-field-key={key}>
      <EffectFormField
        schema={schema}
        value={values[key]}
        error={errors?.[key]}
        onChange={(v) => onChange(key, v)}
      />
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Image inputs - side by side if multiple */}
      {imageInputs.length > 1 ? (
        <div className="grid grid-cols-2 gap-3">
          {imageInputs.map(([key, schema]) => renderField(key, schema))}
        </div>
      ) : (
        imageInputs.map(([key, schema]) => renderField(key, schema))
      )}
      {/* Prompt inputs */}
      {promptInputs.map(([key, schema]) => renderField(key, schema))}
      {/* Other inputs */}
      {otherInputs.map(([key, schema]) => renderField(key, schema))}
    </div>
  )
}
