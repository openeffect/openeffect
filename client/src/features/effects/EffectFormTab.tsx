import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, RotateCcw, X as XIcon } from 'lucide-react'
import { useStore } from '@/store'
import { selectSelectedEffect } from '@/store/selectors/effectsSelectors'
import { selectRestoredParams } from '@/store/selectors/runSelectors'
import { selectAvailableModels } from '@/store/selectors/configSelectors'
import {
  selectEditorIsOpen,
  selectSavedManifest,
  selectEditingEffectId,
  selectEditorYaml,
  selectEditorLastSavedYaml,
} from '@/store/selectors/editorSelectors'
import { startRun } from '@/store/actions/runActions'
import { EffectFormRenderer } from './EffectFormRenderer'
import { EffectFormField } from './EffectFormField'
import { Checkbox } from '@/components/ui/Checkbox'
import { ModelSelector } from './ModelSelector'
import { AdvancedSettings } from './AdvancedSettings'
import { GenerateButton } from './GenerateButton'
import { RestoreFormBanner } from '@/components/RestoreFormBanner'
import { Button } from '@/components/ui/Button'
import { Label } from '@/components/ui/Label'
import { Input } from '@/components/ui/Input'
import { cn } from '@/utils/cn'
import type { ModelParam } from '@/types/api'

export function EffectFormTab() {
  const selectedEffect = useStore(selectSelectedEffect)
  const editorSavedManifest = useStore(selectSavedManifest)
  const isEditorOpen = useStore(selectEditorIsOpen)
  const editingEffectId = useStore(selectEditingEffectId)
  const editorYaml = useStore(selectEditorYaml)
  const editorLastSaved = useStore(selectEditorLastSavedYaml)
  const restoredParams = useStore(selectRestoredParams)
  const availableModels = useStore(selectAvailableModels)

  const manifest = isEditorOpen
    ? (editorSavedManifest ?? selectedEffect)
    : selectedEffect

  const compatibleModels = manifest?.compatible_models ?? []
  const defaultModel = manifest?.generation?.default_model || compatibleModels[0] || ''

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [selectedModel, setSelectedModel] = useState(defaultModel)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [outputValues, setOutputValues] = useState<Record<string, string | number>>({})
  const [advancedValues, setAdvancedValues] = useState<Record<string, unknown>>({})
  const [generateAudio, setGenerateAudio] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  // Get model params
  const modelInfo = availableModels.find((m) => m.id === selectedModel)
  const outputParams = modelInfo?.output_params ?? []
  const advancedParams = (modelInfo?.advanced_params ?? []).map((p) => {
    const manifestDefault = manifest?.generation?.defaults?.[p.key]
    return manifestDefault !== undefined ? { ...p, default: manifestDefault } : p
  })

  // Initialize output values and auto-select first available provider when model changes
  const prevModelRef = useRef(selectedModel)
  useEffect(() => {
    if (selectedModel === prevModelRef.current) return
    prevModelRef.current = selectedModel
    const defaults: Record<string, string | number> = {}
    for (const param of outputParams) {
      defaults[param.key] =
        manifest?.generation.model_overrides?.[selectedModel]?.defaults?.[param.key]
        ?? manifest?.generation.defaults?.[param.key]
        ?? param.default
    }
    setOutputValues(defaults)
    setAdvancedValues({})

    if (modelInfo) {
      const firstAvailable = modelInfo.providers.find((p) => p.is_available)
      setSelectedProvider(firstAvailable?.id ?? modelInfo.providers[0]?.id ?? '')
    }
  }, [selectedModel, outputParams, modelInfo])

  // Initialize form values from manifest on mount (component remounts via key on manifest change)
  useEffect(() => {
    if (!manifest) return
    const next: Record<string, unknown> = {}
    for (const [key, schema] of Object.entries(manifest.inputs ?? {})) {
      if (schema.type === 'select' && 'default' in schema) {
        next[key] = schema.default
      }
      if (schema.type === 'image' && 'default' in schema && schema.default) {
        next[key] = { __defaultAsset: true, filename: schema.default }
      }
    }
    setValues(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Consume restoredParams
  useEffect(() => {
    if (!restoredParams || !manifest) return

    setSelectedModel(
      restoredParams.modelId && compatibleModels.includes(restoredParams.modelId)
        ? restoredParams.modelId
        : defaultModel
    )

    if (restoredParams.output) {
      setOutputValues(restoredParams.output as Record<string, string | number>)
    }

    const next: Record<string, unknown> = {}
    if (restoredParams.inputs) {
      for (const [key, schema] of Object.entries(manifest?.inputs ?? {})) {
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

    const restored = restoredParams.userParams ?? {}
    setAdvancedValues(restored)

    // Restore audio toggle from user_params
    const audioOn = !!(restored.generate_audio || restored.generate_audio_switch)
    setGenerateAudio(audioOn)
  }, [restoredParams, manifest])

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Auto-detect aspect ratio from uploaded image
  const hasAspectRatioParam = outputParams.some((p) => p.key === 'aspect_ratio')
  useEffect(() => {
    if (!manifest || !hasAspectRatioParam) return
    for (const [key, schema] of Object.entries(manifest?.inputs ?? {})) {
      if (schema.type === 'image') {
        const val = values[key]
        if (val instanceof File) {
          const img = new window.Image()
          img.onload = () => {
            const ratio = img.naturalWidth / img.naturalHeight
            let ar = '1:1'
            if (ratio > 1.2) ar = '16:9'
            else if (ratio < 0.8) ar = '9:16'
            setOutputValues((prev) => ({ ...prev, aspect_ratio: ar }))
            URL.revokeObjectURL(img.src)
          }
          img.src = URL.createObjectURL(val)
          break
        }
      }
    }
  }, [values, manifest, hasAspectRatioParam])

  const handleAdvancedChange = useCallback((key: string, value: unknown) => {
    setAdvancedValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Compute unmatched restored inputs
  const unmatchedInputs = useMemo(() => {
    if (!restoredParams?.inputs || !manifest) return []
    const currentKeys = new Set(Object.keys(manifest.inputs ?? {}))
    return Object.entries(restoredParams.inputs)
      .filter(([key]) => !currentKeys.has(key))
      .map(([key, value]) => ({
        key,
        value,
        label: key,
        type: 'text' as const,
      }))
  }, [restoredParams, manifest])

  // Advanced manifest inputs (hidden from main form, shown in advanced section)
  const advancedInputs = Object.entries(manifest?.inputs ?? {}).filter(([_, s]) => s.advanced)

  if (!manifest) return null

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      const finalAdvanced = { ...advancedValues }
      if (generateAudio && modelInfo?.supports_audio && modelInfo.audio_param_key) {
        finalAdvanced[modelInfo.audio_param_key] = true
      }
      await startRun(
        manifest,
        values,
        selectedModel || defaultModel,
        selectedProvider,
        outputValues,
        finalAdvanced,
      )
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const selectedProviderInfo = modelInfo?.providers.find((p) => p.id === selectedProvider)
  const editorDirty = isEditorOpen && editorYaml !== editorLastSaved
  const editorUnsaved = isEditorOpen && !editingEffectId
  const canGenerate = selectedProviderInfo?.is_available === true && !editorDirty && !editorUnsaved

  return (
    <>
      <RestoreFormBanner kind="effect" />
      {/* Form body */}
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <ModelSelector
          compatibleModels={compatibleModels}
          availableModels={availableModels}
          selectedModel={selectedModel || defaultModel}
          selectedProvider={selectedProvider}
          onModelChange={setSelectedModel}
          onProviderChange={setSelectedProvider}
        />
        <EffectFormRenderer manifest={manifest} values={values} onChange={handleChange} />

        {outputParams.length > 0 && (
          <div className="space-y-5">
            {outputParams.map((param) => (
              <ModelParamField
                key={param.key}
                param={param}
                value={outputValues[param.key] ?? param.default}
                onChange={(v) => setOutputValues((prev) => ({ ...prev, [param.key]: v }))}
              />
            ))}
          </div>
        )}

        {/* Audio toggle — shown when model supports it and effect isn't reversed */}
        {modelInfo?.supports_audio && !manifest?.generation?.reverse && (
          <Checkbox
            label="Generate audio"
            checked={generateAudio}
            onCheckedChange={(v) => setGenerateAudio(v === true)}
          />
        )}

        {(advancedParams.length > 0 || advancedInputs.length > 0) && (
          <AdvancedSettings
            parameters={advancedParams}
            values={advancedValues}
            onChange={handleAdvancedChange}
            manifestDefaults={manifest?.generation?.defaults}
          >
            {/* Advanced manifest inputs (e.g., hidden start_frame with default asset) */}
            {advancedInputs.map(([key, schema]) => (
              schema.type === 'image' ? (
                <div key={key} className="space-y-1.5">
                  <Label variant="form">{schema.label}</Label>
                  <AdvancedImageField
                    schema={schema}
                    value={values[key]}
                    assetUrl={manifest?.assets?.inputs?.[key]}
                    onChange={(v) => handleChange(key, v)}
                    onReset={'default' in schema && schema.default ? () => handleChange(key, { __defaultAsset: true, filename: schema.default }) : undefined}
                  />
                </div>
              ) : (
                <EffectFormField key={key} schema={schema} value={values[key]} onChange={(v) => handleChange(key, v)} />
              )
            ))}
          </AdvancedSettings>
        )}

        {unmatchedInputs.length > 0 && (
          <PreviousParams items={unmatchedInputs} />
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t p-4">
        <GenerateButton onClick={handleGenerate} disabled={!canGenerate} loading={isGenerating} cost={selectedProviderInfo?.cost} />
        {editorUnsaved ? (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Create the effect first to generate
          </p>
        ) : editorDirty ? (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Save your changes first to generate
          </p>
        ) : !selectedProviderInfo?.is_available && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Add your API key in Settings to generate
          </p>
        )}
      </div>
    </>
  )
}

/* --- Advanced image field with default asset preview and reset --- */
function AdvancedImageField({ schema, value, assetUrl, onChange, onReset }: {
  schema: import('@/types/api').InputFieldSchema
  value: unknown
  assetUrl?: string
  onChange: (v: unknown) => void
  onReset?: () => void
}) {
  const isDefaultAsset = value && typeof value === 'object' && '__defaultAsset' in (value as Record<string, unknown>)
  const isFile = value instanceof File
  const hasValue = isDefaultAsset || isFile

  if (isDefaultAsset && assetUrl) {
    // Show asset preview with clear button
    return (
      <div className="flex items-center gap-2">
        <div className="h-12 w-12 overflow-hidden rounded border bg-muted">
          <img src={assetUrl} alt="" className="h-full w-full object-cover" />
        </div>
        <span className="text-xs text-muted-foreground">Default asset</span>
        <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => onChange(null)}>
          <XIcon size={12} />
        </Button>
      </div>
    )
  }

  if (isFile) {
    return (
      <div className="flex items-center gap-2">
        <span className="truncate text-xs text-secondary-foreground">{(value as File).name}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange(null)}>
            <XIcon size={12} />
          </Button>
          {onReset && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onReset} title="Reset to default">
              <RotateCcw size={12} />
            </Button>
          )}
        </div>
      </div>
    )
  }

  // No value — show upload + reset
  return (
    <div className="flex items-center gap-2">
      <EffectFormField schema={schema} value={value} onChange={onChange} />
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} className="shrink-0 h-7 text-xs">
          <RotateCcw size={12} />
          Reset
        </Button>
      )}
    </div>
  )
}

/* --- Renders a single model parameter (select/number/slider) --- */

function ModelParamField({ param, value, onChange }: { param: ModelParam; value: string | number; onChange: (v: string | number) => void }) {
  if (param.type === 'select' && param.options) {
    return (
      <div className="space-y-2">
        <Label variant="form">{param.label}</Label>
        <div className="flex flex-wrap gap-1.5">
          {param.options.map((opt) => {
            const isActive = value === opt.value
            return (
              <Button
                key={String(opt.value)}
                onClick={() => onChange(opt.value)}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
              >
                {opt.label}
              </Button>
            )
          })}
        </div>
        {param.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{param.hint}</p>}
      </div>
    )
  }

  if (param.type === 'number') {
    return (
      <div className="space-y-2">
        <Label variant="form">{param.label}</Label>
        <Input
          type="number"
          value={value}
          min={param.min}
          max={param.max}
          step={param.step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {param.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{param.hint}</p>}
      </div>
    )
  }

  if (param.type === 'slider' && param.min != null && param.max != null) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label variant="form" className="mb-0">{param.label}</Label>
          <span className="text-xs font-medium tabular-nums text-secondary-foreground">
            {String(value)}
          </span>
        </div>
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
        />
        {param.hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{param.hint}</p>}
      </div>
    )
  }

  return null
}

/* ─── Previous parameters (unmatched fields) ─── */
function PreviousParams({ items }: { items: { key: string; value: string; label: string; type: string }[] }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="rounded-lg border border-dashed border-border/60">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown size={12} className={cn('transition-transform', !isOpen && '-rotate-90')} />
        Previous parameters ({items.length})
      </button>
      {isOpen && (
        <div className="space-y-3 px-3 pb-3">
          {items.map(({ key, value, label, type }) => (
            <div key={key} className="opacity-50">
              <Label variant="form">{label}</Label>
              {type === 'image' ? (
                <div className="mt-1 overflow-hidden rounded-lg border bg-muted">
                  <img
                    src={`/api/uploads/${value}/512.jpg`}
                    alt={label}
                    className="max-h-28 w-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                  <p className="truncate px-2 py-1 text-[10px] text-muted-foreground">{value}</p>
                </div>
              ) : (
                <Input
                  value={value}
                  readOnly
                  className="mt-1 bg-muted text-xs"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
