import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import { selectAvailableModels, selectDefaultModel } from '@/store/selectors/configSelectors'
import { selectRestoredParams } from '@/store/selectors/runSelectors'
import { startPlaygroundRun } from '@/store/actions/playgroundActions'
import { ModelSelector } from '@/features/effects/ModelSelector'
import { AdvancedSettings } from '@/features/effects/AdvancedSettings'
import { GenerateButton } from '@/features/effects/GenerateButton'
import { ImageUploader } from '@/components/ImageUploader'
import { RestoreFormBanner } from '@/components/RestoreFormBanner'
import { Textarea } from '@/components/ui/Textarea'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import type { ModelInfo, ModelParam } from '@/types/api'

const ROLE_LABELS: Record<string, string> = {
  start_frame: 'Start frame',
  end_frame: 'End frame',
  reference: 'Reference image',
}

function humanizeRole(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function PlaygroundForm() {
  const availableModels = useStore(selectAvailableModels)
  const defaultModel = useStore(selectDefaultModel)
  const restoredParams = useStore(selectRestoredParams)

  const [selectedModel, setSelectedModel] = useState<string>(defaultModel || availableModels[0]?.id || '')
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [imageInputs, setImageInputs] = useState<Record<string, File | string>>({})
  const [outputValues, setOutputValues] = useState<Record<string, string | number>>({})
  const [advancedValues, setAdvancedValues] = useState<Record<string, unknown>>({})
  const [generateAudio, setGenerateAudio] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const modelInfo: ModelInfo | undefined = availableModels.find((m) => m.id === selectedModel)
  const supportedRoles = modelInfo?.supported_image_roles ?? []
  const outputParams: ModelParam[] = modelInfo?.output_params ?? []
  const advancedParams: ModelParam[] = modelInfo?.advanced_params ?? []

  // When the model changes, reset output/advanced/image params to their defaults for the new model.
  // First render is skipped (defaults are already empty/from initial state).
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const defaults: Record<string, string | number> = {}
    for (const param of outputParams) {
      defaults[param.key] = param.default
    }
    setOutputValues(defaults)
    setAdvancedValues({})
    setGenerateAudio(false)
    setImageInputs((prev) => {
      const next: Record<string, File | string> = {}
      for (const role of supportedRoles) {
        if (prev[role]) next[role] = prev[role]
      }
      return next
    })
    // Auto-pick first available provider for the new model
    if (modelInfo) {
      const firstAvailable = modelInfo.providers.find((p) => p.is_available)
      setSelectedProvider(firstAvailable?.id ?? modelInfo.providers[0]?.id ?? '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel])

  // On initial mount, populate output defaults from the picked model.
  useEffect(() => {
    if (Object.keys(outputValues).length > 0) return
    const defaults: Record<string, string | number> = {}
    for (const param of outputParams) {
      defaults[param.key] = param.default
    }
    if (Object.keys(defaults).length > 0) setOutputValues(defaults)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelInfo])

  // Consume restoredParams (set by the Reuse button on a historical run).
  // Mirrors EffectFormTab's restoredParams useEffect, but applies the unified
  // playground inputs shape: { prompt, negative_prompt, <role>: ref_id, ... }.
  useEffect(() => {
    if (!restoredParams) return

    // Restore the model first; the model-change useEffect would otherwise wipe params.
    if (restoredParams.modelId && availableModels.some((m) => m.id === restoredParams.modelId)) {
      setSelectedModel(restoredParams.modelId)
      isFirstRender.current = true  // skip the wipe-on-model-change effect for this restore
    }

    // Pull prompt + negative_prompt; everything else is a role-keyed image ref.
    const inputs = restoredParams.inputs ?? {}
    const nextImages: Record<string, File | string> = {}
    let restoredPrompt = ''
    let restoredNegative = ''
    for (const [key, value] of Object.entries(inputs)) {
      if (key === 'prompt') restoredPrompt = String(value ?? '')
      else if (key === 'negative_prompt') restoredNegative = String(value ?? '')
      else if (typeof value === 'string' && value) nextImages[key] = value
    }
    setPrompt(restoredPrompt)
    setNegativePrompt(restoredNegative)
    setImageInputs(nextImages)

    if (restoredParams.output) {
      setOutputValues(restoredParams.output as Record<string, string | number>)
    } else {
      setOutputValues({})
    }

    const restoredUserParams = (restoredParams.userParams ?? {}) as Record<string, unknown>
    setAdvancedValues(restoredUserParams)
    setGenerateAudio(!!(restoredUserParams.generate_audio || restoredUserParams.generate_audio_switch))
  }, [restoredParams, availableModels])

  // Pick a default provider on mount when the model has providers but none was restored.
  useEffect(() => {
    if (selectedProvider || !modelInfo) return
    const firstAvailable = modelInfo.providers.find((p) => p.is_available)
    setSelectedProvider(firstAvailable?.id ?? modelInfo.providers[0]?.id ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelInfo])

  // Models may load AFTER the form mounts (loadConfig runs in initializeApp's
  // useEffect, not awaited before render). When they arrive, fall back to a
  // sensible default if the locally-held selectedModel is empty or invalid.
  useEffect(() => {
    if (availableModels.length === 0) return
    if (selectedModel && availableModels.some((m) => m.id === selectedModel)) return
    const fallback = defaultModel || availableModels[0]?.id || ''
    if (fallback) setSelectedModel(fallback)
  }, [availableModels, defaultModel, selectedModel])

  const handleImageChange = (role: string, file: File | null) => {
    setImageInputs((prev) => {
      const next = { ...prev }
      if (file) {
        next[role] = file
      } else {
        delete next[role]
      }
      return next
    })
  }

  const handleAdvancedChange = (key: string, value: unknown) => {
    setAdvancedValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleGenerate = async () => {
    setError(null)
    if (!prompt.trim()) {
      setError('Prompt is required')
      return
    }
    if (!selectedModel) {
      setError('Pick a model')
      return
    }
    setIsGenerating(true)
    try {
      const finalAdvanced = { ...advancedValues }
      if (generateAudio && modelInfo?.supports_audio && modelInfo.audio_param_key) {
        finalAdvanced[modelInfo.audio_param_key] = true
      }
      await startPlaygroundRun({
        modelId: selectedModel,
        providerId: selectedProvider,
        prompt,
        negativePrompt,
        imageInputs,
        output: outputValues,
        userParams: finalAdvanced as Record<string, number | string | boolean>,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const selectedProviderInfo = modelInfo?.providers.find((p) => p.id === selectedProvider)
  // Pretend every model is "compatible" so ModelSelector shows the full list.
  const allModelIds = useMemo(() => availableModels.map((m) => m.id), [availableModels])
  // Match the effect page: only gate on having an available provider. The prompt
  // requirement is enforced on click via setError, so the button stays visible
  // (just dimmed) and tells the user what's missing on attempt.
  const canGenerate = !!selectedProviderInfo?.is_available

  return (
    <>
      <RestoreFormBanner kind="playground" />
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <ModelSelector
          compatibleModels={allModelIds}
          availableModels={availableModels}
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          onModelChange={setSelectedModel}
          onProviderChange={setSelectedProvider}
        />

        {/* Image inputs — driven by the model's supported roles */}
        {supportedRoles.length > 0 && (
          <div className="space-y-4">
            {supportedRoles.map((role) => {
              const value = imageInputs[role]
              return (
                <div key={role}>
                  <ImageUploader
                    label={humanizeRole(role)}
                    value={value instanceof File ? value : null}
                    restoredUrl={typeof value === 'string' && value ? `/api/uploads/${value}/512` : null}
                    onChange={(f) => handleImageChange(role, f)}
                  />
                </div>
              )
            })}
          </div>
        )}

        {/* Prompt */}
        <div className="space-y-2">
          <Label variant="form">Prompt</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want to generate..."
            rows={4}
          />
        </div>

        {/* Negative prompt */}
        <div className="space-y-2">
          <Label variant="form">Negative prompt (optional)</Label>
          <Textarea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="What to avoid..."
            rows={2}
          />
        </div>

        {/* Output params (model-specific) */}
        {outputParams.length > 0 && (
          <div className="space-y-5">
            {outputParams.map((param) => (
              <PlaygroundParamField
                key={param.key}
                param={param}
                value={outputValues[param.key] ?? param.default}
                onChange={(v) => setOutputValues((prev) => ({ ...prev, [param.key]: v }))}
              />
            ))}
          </div>
        )}

        {/* Audio toggle */}
        {modelInfo?.supports_audio && (
          <Checkbox
            label="Generate audio"
            checked={generateAudio}
            onCheckedChange={(v) => setGenerateAudio(v === true)}
          />
        )}

        {/* Advanced */}
        {advancedParams.length > 0 && (
          <AdvancedSettings
            parameters={advancedParams}
            values={advancedValues}
            onChange={handleAdvancedChange}
          />
        )}

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t p-4">
        <GenerateButton
          onClick={handleGenerate}
          disabled={!canGenerate}
          loading={isGenerating}
          cost={selectedProviderInfo?.cost}
        />
        {!selectedProviderInfo?.is_available && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Add your API key in Settings to generate
          </p>
        )}
      </div>
    </>
  )
}

/* Renders a single output param (select/slider/number). Mirrors the helper inside EffectFormTab. */
function PlaygroundParamField({
  param,
  value,
  onChange,
}: {
  param: ModelParam
  value: string | number
  onChange: (v: string | number) => void
}) {
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
          <span className="text-xs font-medium tabular-nums text-secondary-foreground">{String(value)}</span>
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
