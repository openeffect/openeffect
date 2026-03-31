import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import type { ModelParam } from '@/types/api'

const LABEL = "text-xs font-semibold uppercase tracking-wider"
const LABEL_S = { color: 'var(--text-tertiary)' }
const INPUT = "w-full rounded-lg px-3 py-2 text-sm outline-none"
const INPUT_S = { background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
const HINT = "text-[11px]"
const HINT_S = { color: 'var(--text-tertiary)' }

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
                    <div key={param.key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className={LABEL} style={LABEL_S}>{param.label}</label>
                        <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-secondary)' }}>
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
                      {param.hint && <p className={HINT} style={HINT_S}>{param.hint}</p>}
                    </div>
                  )
                }

                if (param.type === 'text') {
                  return (
                    <div key={param.key} className="space-y-2">
                      <label className={LABEL} style={LABEL_S}>{param.label}</label>
                      {param.multiline ? (
                        <textarea
                          value={String(values[param.key] ?? defaultVal)}
                          onChange={(e) => onChange(param.key, e.target.value)}
                          rows={2}
                          className={`${INPUT} resize-none`}
                          style={INPUT_S}
                        />
                      ) : (
                        <input
                          type="text"
                          value={String(values[param.key] ?? defaultVal)}
                          onChange={(e) => onChange(param.key, e.target.value)}
                          className={INPUT}
                          style={INPUT_S}
                        />
                      )}
                      {param.hint && <p className={HINT} style={HINT_S}>{param.hint}</p>}
                    </div>
                  )
                }

                if (param.type === 'number') {
                  return (
                    <div key={param.key} className="space-y-2">
                      <label className={LABEL} style={LABEL_S}>{param.label}</label>
                      <input
                        type="number"
                        value={Number(values[param.key] ?? defaultVal)}
                        onChange={(e) => onChange(param.key, Number(e.target.value))}
                        className={INPUT}
                        style={INPUT_S}
                      />
                      {param.hint && <p className={HINT} style={HINT_S}>{param.hint}</p>}
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
