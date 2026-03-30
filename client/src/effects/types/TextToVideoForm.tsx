import type { InputFieldSchema } from '@/types/api'
import { EffectFormField } from '../components/EffectFormField'

interface TextToVideoFormProps {
  inputs: Record<string, InputFieldSchema>
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

export function TextToVideoForm({ inputs, values, onChange }: TextToVideoFormProps) {
  // Prompt first, then other fields
  const promptField = Object.entries(inputs).find(([k]) => k === 'prompt')
  const otherFields = Object.entries(inputs).filter(([k]) => k !== 'prompt')

  return (
    <div className="space-y-4">
      {promptField && (
        <EffectFormField
          fieldKey={promptField[0]}
          schema={promptField[1]}
          value={values[promptField[0]]}
          onChange={(v) => onChange(promptField[0], v)}
        />
      )}
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
