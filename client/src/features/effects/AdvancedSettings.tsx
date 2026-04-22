import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import type { ModelParam } from '@/types/api'
import { Label } from '@/components/ui/Label'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'

interface AdvancedSettingsProps {
  parameters: ModelParam[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  children?: React.ReactNode
}

export function AdvancedSettings({ parameters, values, onChange, children }: AdvancedSettingsProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (parameters.length === 0 && !children) return null

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 py-2 text-sm font-medium text-secondary-foreground hover:text-foreground"
      >
        <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronRight size={16} />
        </motion.div>
        Advanced settings
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
            animate={{ height: 'auto', opacity: 1, overflow: 'visible', transition: { duration: 0.2, overflow: { delay: 0.2 } } }}
            exit={{ height: 0, opacity: 0, overflow: 'hidden', transition: { duration: 0.15 } }}
          >
            <div className="space-y-5 pb-2 pt-4">
              {children}
              {parameters.map((param) => {
                const defaultVal = param.default

                if (param.type === 'slider' && param.min != null && param.max != null) {
                  return (
                    <div key={param.key} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label variant="form" className="mb-0">{param.label}</Label>
                        <span className="text-xs font-medium tabular-nums text-secondary-foreground">
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
                      {param.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{param.hint}</p>}
                    </div>
                  )
                }

                if (param.type === 'text') {
                  return (
                    <div key={param.key} className="space-y-2">
                      <Label variant="form">{param.label}</Label>
                      {param.multiline ? (
                        <Textarea
                          value={String(values[param.key] ?? defaultVal)}
                          onChange={(e) => onChange(param.key, e.target.value)}
                          rows={2}
                        />
                      ) : (
                        <Input
                          type="text"
                          value={String(values[param.key] ?? defaultVal)}
                          onChange={(e) => onChange(param.key, e.target.value)}
                        />
                      )}
                      {param.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{param.hint}</p>}
                    </div>
                  )
                }

                if (param.type === 'number') {
                  return (
                    <div key={param.key} className="space-y-2">
                      <Label variant="form">{param.label}</Label>
                      <Input
                        type="number"
                        value={Number(values[param.key] ?? defaultVal)}
                        onChange={(e) => onChange(param.key, Number(e.target.value))}
                      />
                      {param.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{param.hint}</p>}
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
