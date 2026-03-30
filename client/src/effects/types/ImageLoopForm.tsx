import type { InputFieldSchema } from '@/types/api'
import { EffectFormField } from '../components/EffectFormField'

interface ImageLoopFormProps {
  inputs: Record<string, InputFieldSchema>
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

export function ImageLoopForm({ inputs, values, onChange }: ImageLoopFormProps) {
  return (
    <div className="space-y-4">
      {Object.entries(inputs).map(([key, schema]) => (
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
