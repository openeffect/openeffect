import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import type { ModelParam } from '@/types/api'

interface AdvancedSettingsProps {
  parameters: ModelParam[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  manifestDefaults?: Record<string, unknown>
}

export function AdvancedSettings({ parameters, values, onChange, manifestDefaults }: AdvancedSettingsProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (parameters.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 py-2 text-sm font-medium"
        style={{ color: 'var(--text-secondary)' }}
      >
        <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronRight size={16} />
        </motion.div>
        Advanced settings
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: { duration: 0.2 } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
            className="overflow-hidden"
          >
            <div className="space-y-4 pb-2 pt-1">
              {parameters.map((param) => {
                const effectDefault = manifestDefaults?.[param.key]
                const defaultVal = effectDefault ?? param.default

                if (param.type === 'slider' && param.min != null && param.max != null) {
                  return (
                    <div key={param.key} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {param.label}
                        </label>
                        <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                          {String(values[param.key] ?? defaultVal)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={param.min}
                        max={param.max}
                        step={param.step ?? 1}
                        value={Number(values[param.key] ?? defaultVal)}
                        onChange={(e) => onChange(param.key, Number(e.target.value))}
                        className="w-full"
                      />
                      {param.hint && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{param.hint}</p>}
                    </div>
                  )
                }

                if (param.type === 'text') {
                  return (
                    <div key={param.key} className="space-y-1.5">
                      <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {param.label}
                      </label>
                      {param.multiline ? (
                        <textarea
                          value={String(values[param.key] ?? defaultVal)}
                          onChange={(e) => onChange(param.key, e.target.value)}
                          rows={2}
                          className="w-full resize-none rounded-lg px-3 py-2 text-xs outline-none"
                          style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                        />
                      ) : (
                        <input
                          type="text"
                          value={String(values[param.key] ?? defaultVal)}
                          onChange={(e) => onChange(param.key, e.target.value)}
                          className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                          style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                        />
                      )}
                      {param.hint && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{param.hint}</p>}
                    </div>
                  )
                }

                if (param.type === 'number') {
                  return (
                    <div key={param.key} className="space-y-1.5">
                      <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {param.label}
                      </label>
                      <input
                        type="number"
                        value={Number(values[param.key] ?? defaultVal)}
                        onChange={(e) => onChange(param.key, Number(e.target.value))}
                        className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                        style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                      />
                      {param.hint && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{param.hint}</p>}
                    </div>
                  )
                }

                return null
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
