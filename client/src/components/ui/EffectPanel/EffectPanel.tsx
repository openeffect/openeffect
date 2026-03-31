import { useState, useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useSelectedEffect, useEffectsStore } from '@/store/effectsStore'
import { useGenerationStore } from '@/store/generationStore'
import { useConfigStore } from '@/store/configStore'
import { api } from '@/lib/api'
import { formatEffectType } from '@/lib/formatters'
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
  const restoredParams = useGenerationStore((s) => s.restoredParams)
  const hasApiKey = useConfigStore((s) => s.hasApiKey)

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [selectedModel, setSelectedModel] = useState(manifest?.generation.default_model ?? '')
  const [aspectRatio, setAspectRatio] = useState(manifest?.output.default_aspect_ratio ?? '9:16')
  const [duration, setDuration] = useState(manifest?.output.default_duration ?? 5)
  const [advancedValues, setAdvancedValues] = useState<Record<string, unknown>>({})
  const [isGenerating, setIsGenerating] = useState(false)

  // Track effect changes — keep matching fields, reset the rest
  const prevEffectId = useRef(manifest?.id)
  useEffect(() => {
    if (!manifest || manifest.id === prevEffectId.current) return
    prevEffectId.current = manifest.id

    // Keep values for fields that exist in the new manifest with the same type
    setValues((prev) => {
      const next: Record<string, unknown> = {}
      for (const [key, schema] of Object.entries(manifest.inputs)) {
        if (key in prev && prev[key] != null) {
          next[key] = prev[key]
        }
        // Pre-fill select defaults if not carried over
        if (!(key in next) && schema.type === 'select' && 'default' in schema) {
          next[key] = schema.default
        }
      }
      return next
    })

    setSelectedModel((prev) =>
      manifest.generation.supported_models.includes(prev) ? prev : manifest.generation.default_model
    )
    setAspectRatio((prev) =>
      manifest.output.aspect_ratios.includes(prev) ? prev : manifest.output.default_aspect_ratio
    )
    setDuration((prev) =>
      manifest.output.durations.includes(prev) ? prev : manifest.output.default_duration
    )
    // Keep advanced values for keys that exist in the new manifest's advanced_parameters
    setAdvancedValues((prev) => {
      const validKeys = new Set(manifest.generation.advanced_parameters.map((p) => p.key))
      const next: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(prev)) {
        if (validKeys.has(key)) next[key] = val
      }
      return next
    })
  }, [manifest])

  // Consume restoredParams when they are set — fully replaces all form state
  useEffect(() => {
    if (!restoredParams || !manifest) return

    // Apply restored model
    setSelectedModel(
      restoredParams.modelId && manifest.generation.supported_models.includes(restoredParams.modelId)
        ? restoredParams.modelId
        : manifest.generation.default_model
    )

    // Apply restored output settings
    setAspectRatio(
      restoredParams.output && manifest.output.aspect_ratios.includes(restoredParams.output.aspect_ratio)
        ? restoredParams.output.aspect_ratio
        : manifest.output.default_aspect_ratio
    )
    setDuration(
      restoredParams.output && manifest.output.durations.includes(restoredParams.output.duration)
        ? restoredParams.output.duration
        : manifest.output.default_duration
    )

    // Apply restored inputs — fully replace values
    const next: Record<string, unknown> = {}
    if (restoredParams.inputs) {
      for (const [key, schema] of Object.entries(manifest.inputs)) {
        if (key in restoredParams.inputs) {
          if (schema.type === 'image') {
            next[key] = { __restored: true, filename: restoredParams.inputs[key] }
          } else {
            next[key] = restoredParams.inputs[key]
          }
        }
      }
    }
    setValues(next)

    // Apply restored user params
    setAdvancedValues(restoredParams.userParams ?? {})

    // Clear restoredParams after consuming
    useGenerationStore.setState({ restoredParams: null })
  }, [restoredParams, manifest])

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
          const val = values[key]
          if (val instanceof File) {
            const uploaded = await api.upload(val)
            inputs[key] = uploaded.ref_id
          } else if (val && typeof val === 'object' && '__restored' in (val as Record<string, unknown>)) {
            // Restored image — use the filename as-is (it was already uploaded)
            inputs[key] = (val as { filename: string }).filename
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
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {manifest.name}
            </h2>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              {formatEffectType(manifest.effect_type)}
            </span>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {manifest.description.slice(0, 60)}
            {manifest.description.length > 60 ? '...' : ''}
          </p>
        </div>
        <button
          onClick={() => selectEffect(null)}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
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
