import { useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { useSelectedEffect, useEffectsStore } from '@/store/effectsStore'
import { useGenerationStore } from '@/store/generationStore'
import { useConfigStore } from '@/store/configStore'
import { api } from '@/lib/api'
import { EffectFormRenderer } from '@/effects/EffectFormRenderer'
import { ModelSelector } from '@/effects/components/ModelSelector'
import { AspectRatioSelector } from '@/effects/components/AspectRatioSelector'
import { DurationSelector } from '@/effects/components/DurationSelector'
import { AdvancedSettings } from '@/effects/components/AdvancedSettings'
import { GenerateButton } from '@/effects/components/GenerateButton'
import type { GenerationRequest } from '@/types/api'

export function EffectPanel() {
  const manifest = useSelectedEffect()
  const selectEffect = useEffectsStore((s) => s.selectEffect)
  const startGeneration = useGenerationStore((s) => s.startGeneration)
  const hasApiKey = useConfigStore((s) => s.hasApiKey)

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [selectedModel, setSelectedModel] = useState(manifest?.generation.default_model ?? '')
  const [aspectRatio, setAspectRatio] = useState(manifest?.output.default_aspect_ratio ?? '9:16')
  const [duration, setDuration] = useState(manifest?.output.default_duration ?? 5)
  const [advancedValues, setAdvancedValues] = useState<Record<string, unknown>>({})
  const [isGenerating, setIsGenerating] = useState(false)

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleAdvancedChange = useCallback((key: string, value: unknown) => {
    setAdvancedValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  if (!manifest) return null

  const fullId = `${manifest.effect_type.replace(/_/g, '-')}/${manifest.id}`

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      const inputs: Record<string, string> = {}
      for (const [key, schema] of Object.entries(manifest.inputs)) {
        if (schema.type === 'image') {
          const file = values[key] as File | null
          if (file) {
            const uploaded = await api.upload(file)
            inputs[key] = uploaded.ref_id
          } else if (schema.required) {
            alert(`Please upload ${schema.label}`)
            setIsGenerating(false)
            return
          }
        } else {
          const val = values[key]
          if (val != null && val !== '') {
            inputs[key] = String(val)
          } else if (schema.type === 'select' && 'default' in schema) {
            inputs[key] = schema.default
          }
        }
      }

      const request: GenerationRequest = {
        effect_id: fullId,
        model_id: selectedModel || manifest.generation.default_model,
        inputs,
        output: { aspect_ratio: aspectRatio, duration },
        user_params:
          Object.keys(advancedValues).length > 0
            ? (advancedValues as Record<string, number | string>)
            : undefined,
      }

      await startGeneration(request, manifest.name)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const canGenerate = selectedModel.startsWith('local/') || hasApiKey

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between px-5 py-3.5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {manifest.name}
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {manifest.description.slice(0, 60)}
            {manifest.description.length > 60 ? '...' : ''}
          </p>
        </div>
        <button
          onClick={() => selectEffect(null)}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:brightness-125"
          style={{ background: 'var(--surface-elevated)', color: 'var(--text-tertiary)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Form body */}
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <ModelSelector
          models={manifest.generation.supported_models}
          selectedModel={selectedModel || manifest.generation.default_model}
          onChange={setSelectedModel}
        />
        <EffectFormRenderer manifest={manifest} values={values} onChange={handleChange} />

        <div className="flex gap-5">
          <AspectRatioSelector
            ratios={manifest.output.aspect_ratios}
            selected={aspectRatio}
            onChange={setAspectRatio}
          />
          <DurationSelector
            durations={manifest.output.durations}
            selected={duration}
            onChange={setDuration}
          />
        </div>

        <AdvancedSettings
          parameters={manifest.generation.advanced_parameters}
          values={advancedValues}
          onChange={handleAdvancedChange}
        />
      </div>

      {/* Footer */}
      <div className="shrink-0 p-4" style={{ borderTop: '1px solid var(--border)' }}>
        <GenerateButton onClick={handleGenerate} disabled={!canGenerate} loading={isGenerating} />
        {!canGenerate && (
          <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Add your fal.ai API key in Settings to generate
          </p>
        )}
      </div>
    </div>
  )
}
