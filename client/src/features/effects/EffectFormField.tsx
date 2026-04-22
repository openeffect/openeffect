import type { InputFieldSchema } from '@/types/api'
import { ImageUploader } from '@/components/ImageUploader'
import { Label } from '@/components/ui/Label'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'

interface EffectFormFieldProps {
  schema: InputFieldSchema
  value: unknown
  error?: string | null
  onChange: (value: unknown) => void
}

export function EffectFormField({ schema, value, error, onChange }: EffectFormFieldProps) {
  // A field only needs an asterisk when the user must act. Image/text fields
  // have no default, so required=true means "user must fill this". Select/
  // slider/number always carry a default, so they never show the asterisk —
  // the form is satisfied even when the user ignores them.
  switch (schema.type) {
    case 'image': {
      const isRestored = value && typeof value === 'object' && '__restored' in (value as Record<string, unknown>)
      const restored = isRestored ? (value as { filename: string }) : null
      const restoredUrl = restored ? `/api/uploads/${restored.filename}/512.jpg` : null

      return (
        <ImageUploader
          label={schema.label}
          hint={schema.hint}
          required={schema.required}
          error={!!error}
          value={isRestored ? null : (value as File | null)}
          onChange={onChange}
          restoredUrl={restoredUrl}
        />
      )
    }

    case 'text':
      return (
        <div className="space-y-2">
          <Label variant="form">
            {schema.label}
            {schema.required && <span className="text-destructive"> *</span>}
          </Label>
          {schema.multiline ? (
            <Textarea
              value={(value as string) || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={schema.placeholder}
              maxLength={schema.max_length}
              rows={3}
              error={!!error}
            />
          ) : (
            <Input
              type="text"
              value={(value as string) || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={schema.placeholder}
              maxLength={schema.max_length}
              error={!!error}
            />
          )}
          {schema.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{schema.hint}</p>}
        </div>
      )

    case 'select': {
      const usePills = schema.display === 'pills' || (!schema.display && schema.options.length <= 3)
      return (
        <div className="space-y-2">
          <Label variant="form">
            {schema.label}
          </Label>
          {usePills ? (
            <div className="flex flex-wrap gap-1.5">
              {schema.options.map((opt) => {
                const isActive = value === opt.value
                return (
                  <Button
                    key={opt.value}
                    onClick={() => onChange(opt.value)}
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                  >
                    {opt.label}
                  </Button>
                )
              })}
            </div>
          ) : (
            <select
              value={(value as string) ?? schema.default}
              onChange={(e) => onChange(e.target.value)}
              className="w-full rounded-lg border bg-muted px-3 py-2 text-sm text-foreground outline-none"
            >
              {schema.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
          {schema.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{schema.hint}</p>}
        </div>
      )
    }

    case 'slider':
      return (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label variant="form" className="mb-0">
              {schema.label}
            </Label>
            <span className="text-xs font-medium tabular-nums text-secondary-foreground">
              {String(value ?? schema.default)}{schema.unit ? ` ${schema.unit}` : ''}
            </span>
          </div>
          <input
            type="range"
            min={schema.min}
            max={schema.max}
            step={schema.step}
            value={(value as number) ?? schema.default}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full"
          />
          {schema.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{schema.hint}</p>}
        </div>
      )

    case 'number':
      return (
        <div className="space-y-2">
          <Label variant="form">
            {schema.label}
          </Label>
          <Input
            type="number"
            value={(value as number) ?? schema.default}
            min={schema.min}
            max={schema.max}
            step={schema.step}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {schema.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{schema.hint}</p>}
        </div>
      )
  }
}
