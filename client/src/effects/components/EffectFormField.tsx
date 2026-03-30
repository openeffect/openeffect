import type { InputFieldSchema } from '@/types/api'
import { ImageUploader } from '@/components/primitives/ImageUploader/ImageUploader'

interface EffectFormFieldProps {
  fieldKey: string
  schema: InputFieldSchema
  value: unknown
  onChange: (value: unknown) => void
}

export function EffectFormField({ fieldKey, schema, value, onChange }: EffectFormFieldProps) {
  switch (schema.type) {
    case 'image':
      return (
        <ImageUploader
          label={schema.label}
          hint={schema.hint}
          accept={schema.accept}
          maxSizeMb={schema.max_size_mb}
          value={value as File | null}
          onChange={onChange}
        />
      )

    case 'text':
      return (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            {schema.label}
            {schema.required && <span style={{ color: 'var(--danger)' }}> *</span>}
          </label>
          {schema.multiline ? (
            <textarea
              value={(value as string) || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={schema.placeholder}
              maxLength={schema.max_length}
              rows={3}
              className="w-full resize-none rounded-lg px-3 py-2.5 text-sm outline-none placeholder:opacity-40"
              style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
          ) : (
            <input
              type="text"
              value={(value as string) || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={schema.placeholder}
              maxLength={schema.max_length}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none placeholder:opacity-40"
              style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
          )}
          {schema.hint && (
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{schema.hint}</p>
          )}
        </div>
      )

    case 'select':
      return (
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            {schema.label}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {schema.options.map((opt) => {
              const isActive = value === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => onChange(opt.value)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                  style={{
                    background: isActive ? 'var(--accent)' : 'var(--surface-elevated)',
                    color: isActive ? 'white' : 'var(--text-secondary)',
                    border: isActive ? '1px solid transparent' : '1px solid var(--border)',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )

    case 'slider':
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              {schema.label}
            </label>
            <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-secondary)' }}>
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
          {schema.hint && (
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{schema.hint}</p>
          )}
        </div>
      )

    case 'number':
      return (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            {schema.label}
          </label>
          <input
            type="number"
            value={(value as number) ?? schema.default}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          {schema.hint && (
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{schema.hint}</p>
          )}
        </div>
      )
  }
}
