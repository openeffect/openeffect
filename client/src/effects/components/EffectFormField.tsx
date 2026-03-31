import type { InputFieldSchema } from '@/types/api'
import { ImageUploader } from '@/components/primitives/ImageUploader/ImageUploader'

interface EffectFormFieldProps {
  fieldKey: string
  schema: InputFieldSchema
  value: unknown
  onChange: (value: unknown) => void
}

const LABEL_CLASS = "text-xs font-semibold uppercase tracking-wider"
const LABEL_STYLE = { color: 'var(--text-tertiary)' }
const INPUT_CLASS = "w-full rounded-lg px-3 py-2 text-sm outline-none placeholder:opacity-40"
const INPUT_STYLE = { background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
const HINT_CLASS = "text-[11px]"
const HINT_STYLE = { color: 'var(--text-tertiary)' }

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
          <label className={LABEL_CLASS} style={LABEL_STYLE}>
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
              className={`${INPUT_CLASS} resize-none`}
              style={INPUT_STYLE}
            />
          ) : (
            <input
              type="text"
              value={(value as string) || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={schema.placeholder}
              maxLength={schema.max_length}
              className={INPUT_CLASS}
              style={INPUT_STYLE}
            />
          )}
          {schema.hint && <p className={HINT_CLASS} style={HINT_STYLE}>{schema.hint}</p>}
        </div>
      )

    case 'select': {
      const usePills = schema.display === 'pills' || (!schema.display && schema.options.length <= 3)
      return (
        <div className="space-y-2">
          <label className={LABEL_CLASS} style={LABEL_STYLE}>
            {schema.label}
          </label>
          {usePills ? (
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
          ) : (
            <select
              value={(value as string) ?? schema.default}
              onChange={(e) => onChange(e.target.value)}
              className={INPUT_CLASS}
              style={INPUT_STYLE}
            >
              {schema.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
          {schema.hint && <p className={HINT_CLASS} style={HINT_STYLE}>{schema.hint}</p>}
        </div>
      )
    }

    case 'slider':
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className={LABEL_CLASS} style={LABEL_STYLE}>
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
          {schema.hint && <p className={HINT_CLASS} style={HINT_STYLE}>{schema.hint}</p>}
        </div>
      )

    case 'number':
      return (
        <div className="space-y-2">
          <label className={LABEL_CLASS} style={LABEL_STYLE}>
            {schema.label}
          </label>
          <input
            type="number"
            value={(value as number) ?? schema.default}
            min={schema.min}
            max={schema.max}
            step={schema.step}
            onChange={(e) => onChange(Number(e.target.value))}
            className={INPUT_CLASS}
            style={INPUT_STYLE}
          />
          {schema.hint && <p className={HINT_CLASS} style={HINT_STYLE}>{schema.hint}</p>}
        </div>
      )
  }
}
