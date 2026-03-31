import type { InputFieldSchema } from '@/types/api'
import { ImageUploader } from '@/primitives/ImageUploader'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

interface EffectFormFieldProps {
  fieldKey: string
  schema: InputFieldSchema
  value: unknown
  onChange: (value: unknown) => void
}

export function EffectFormField({ fieldKey, schema, value, onChange }: EffectFormFieldProps) {
  switch (schema.type) {
    case 'image': {
      const isRestored = value && typeof value === 'object' && '__restored' in (value as Record<string, unknown>)
      const restored = isRestored ? (value as { filename: string }) : null
      const restoredUrl = restored ? `/api/uploads/${restored.filename}` : null

      return (
        <ImageUploader
          label={schema.label}
          hint={schema.hint}
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
            />
          ) : (
            <Input
              type="text"
              value={(value as string) || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={schema.placeholder}
              maxLength={schema.max_length}
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
