import type { InputFieldSchema } from '@/types/api'
import { EffectFormField } from '../components/EffectFormField'

interface ImageTransitionFormProps {
  inputs: Record<string, InputFieldSchema>
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

export function ImageTransitionForm({ inputs, values, onChange }: ImageTransitionFormProps) {
  // Ensure image fields appear first, then other fields
  const imageFields = Object.entries(inputs).filter(([, s]) => s.type === 'image')
  const otherFields = Object.entries(inputs).filter(([, s]) => s.type !== 'image')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {imageFields.map(([key, schema]) => (
          <EffectFormField
            key={key}
            fieldKey={key}
            schema={schema}
            value={values[key]}
            onChange={(v) => onChange(key, v)}
          />
        ))}
      </div>
      {otherFields.map(([key, schema]) => (
        <EffectFormField
          key={key}
          fieldKey={key}
          schema={schema}
          value={values[key]}
          onChange={(v) => onChange(key, v)}
        />
      ))}
    </div>
  )
}
