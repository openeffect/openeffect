import { useRef, useState } from 'react'
import { AlertCircle, X as XIcon } from 'lucide-react'
import { useStore } from '@/store'
import { selectAvailableModels } from '@/store/selectors/configSelectors'
import { selectRestoredParams } from '@/store/selectors/runSelectors'
import { startPlaygroundRun } from '@/store/actions/playgroundActions'
import { ModelSelector } from '@/features/effects/ModelSelector'
import { AdvancedSettings } from '@/features/effects/AdvancedSettings'
import { GenerateButton } from '@/features/effects/GenerateButton'
import { ImageUploader } from '@/components/ImageUploader'
import { DollarBadge } from '@/components/DollarBadge'
import { RestoreFormBanner } from '@/components/RestoreFormBanner'
import { Textarea } from '@/components/ui/Textarea'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import type { ModelInfo, ModelParam } from '@/types/api'
import {
  advancedParams as advancedParamsOf,
  imageInputs as imageInputParams,
  mainParams,
  providerVariant,
} from '@/utils/modelParams'

// Only one variant in the registry today — kept as a constant so re-adding
// v2v later is a one-line change.
const VARIANT_KEY = 'image_to_video'

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
  const restoredParams = useStore(selectRestoredParams)

  const initialModelId = availableModels[0]?.id || ''
  const [selectedModel, setSelectedModel] = useState<string>(initialModelId)
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [imageInputs, setImageInputs] = useState<Record<string, File | string>>({})
  const [outputValues, setOutputValues] = useState<Record<string, string | number | boolean>>({})
  const [advancedValues, setAdvancedValues] = useState<Record<string, unknown>>({})
  const [isGenerating, setIsGenerating] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({})
  const formRef = useRef<HTMLDivElement>(null)

  const modelInfo: ModelInfo | undefined = availableModels.find((m) => m.id === selectedModel)
  const variant = providerVariant(modelInfo, selectedProvider, VARIANT_KEY)
  const imageSlots = imageInputParams(variant)
  const supportedRoles = imageSlots.map((p) => p.key)
  const outputParams: ModelParam[] = mainParams(variant)
  const advancedParams: ModelParam[] = advancedParamsOf(variant)
  const compatibleModels = availableModels.map((m) => m.id)

  // Models may load AFTER the form mounts (loadConfig runs async). When they
  // arrive, fall back to a sensible default if the locally-held selectedModel
  // is empty or invalid. Render-time pattern to avoid setState-in-effect.
  const [prevAvailableModels, setPrevAvailableModels] = useState(availableModels)
  if (availableModels !== prevAvailableModels) {
    setPrevAvailableModels(availableModels)
    if (availableModels.length > 0) {
      const valid = selectedModel && availableModels.some((m) => m.id === selectedModel)
      if (!valid) {
        const fallbackId = availableModels[0]?.id || ''
        if (fallbackId) setSelectedModel(fallbackId)
      }
    }
  }

  // When the model changes, auto-pick the first available provider. Also fires
  // when modelInfo arrives for the initial selectedModel (so the mount-time
  // provider pick is folded into this same block).
  const [prevModel, setPrevModel] = useState<string>('')
  if (selectedModel !== prevModel && modelInfo) {
    setPrevModel(selectedModel)
    const firstAvailable = modelInfo.providers.find((p) => p.is_available)
    setSelectedProvider(firstAvailable?.id ?? modelInfo.providers[0]?.id ?? '')
  }

  // Re-seed output/advanced/image params to the provider-variant defaults
  // whenever (model, provider) changes. An empty prevSeedKey acts as a
  // "skip this cycle" sentinel so restore handlers and the initial mount
  // don't re-seed over freshly-set values.
  const [prevSeedKey, setPrevSeedKey] = useState<string>('')
  if (selectedModel && selectedProvider) {
    const seedKey = `${selectedModel}|${selectedProvider}`
    if (seedKey !== prevSeedKey) {
      const skip = prevSeedKey === ''
      setPrevSeedKey(seedKey)
      if (!skip) {
        const defaults: Record<string, string | number | boolean> = {}
        for (const param of outputParams) {
          if (param.default !== undefined) defaults[param.key] = param.default
        }
        setOutputValues(defaults)
        setAdvancedValues({})
        setImageInputs((prev) => {
          const next: Record<string, File | string> = {}
          for (const role of supportedRoles) {
            if (prev[role]) next[role] = prev[role]
          }
          return next
        })
      }
    }
  }

  // Consume restoredParams (set by the Reuse button on a historical run, or
  // by "Try in Playground" from an effect — which seeds the store *before*
  // this component mounts). Mirrors EffectFormTab's restoredParams handling,
  // but applies the unified playground inputs shape:
  // { prompt, negative_prompt, <role>: file_id, ... }.
  // Sentinel `undefined` init (restoredParams is never undefined) so the
  // first render's comparison fires — otherwise a pre-seeded value would
  // match its own `useState(restoredParams)` and the block would be skipped.
  const [prevRestored, setPrevRestored] = useState<typeof restoredParams | undefined>(undefined)
  if (prevRestored !== restoredParams) {
    setPrevRestored(restoredParams)
    if (restoredParams) {
      // Restore the model first; both auto-pickers (provider change on model
      // switch, and the seed-defaults block) need to be told to skip this
      // cycle — otherwise they'd overwrite the freshly-restored values.
      const restoredModel = restoredParams.modelId
        ? availableModels.find((m) => m.id === restoredParams.modelId)
        : undefined
      if (restoredModel) {
        setSelectedModel(restoredModel.id)
      }
      setPrevSeedKey('')

      // Pull prompt + negative_prompt; everything else is a role-keyed image ref
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
        setOutputValues(restoredParams.output as Record<string, string | number | boolean>)
      } else {
        setOutputValues({})
      }

      const restoredUserParams = (restoredParams.userParams ?? {}) as Record<string, unknown>
      setAdvancedValues(restoredUserParams)
    }
  }

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
    // Validate required fields per-field so we can surface errors inline
    // instead of a single banner.
    const errors: Record<string, string | null> = {}
    if (!prompt.trim()) errors.prompt = 'Prompt is required'
    for (const slot of imageSlots) {
      if (!slot.required) continue
      const v = imageInputs[slot.key]
      if (!(v instanceof File) && (typeof v !== 'string' || !v)) {
        errors[slot.key] = `Please upload ${humanizeRole(slot.key).toLowerCase()}`
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setSubmitError(null)
      requestAnimationFrame(() => {
        const firstKey = Object.keys(errors)[0]
        const el = formRef.current?.querySelector(`[data-field-key="${firstKey}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return
    }
    // "Pick a model" isn't really a field — keep it as the banner
    if (!selectedModel) {
      setSubmitError('Pick a model')
      return
    }

    setFieldErrors({})
    setSubmitError(null)
    setIsGenerating(true)
    try {
      // Only send images the selected model's variant actually accepts —
      // e.g. an end_frame uploaded earlier shouldn't be sent if the user
      // now has PixVerse selected (its i2v variant has no end_frame slot).
      const roleWhitelist = new Set(supportedRoles)
      const filteredImages: Record<string, File | string> = {}
      for (const [role, value] of Object.entries(imageInputs)) {
        if (roleWhitelist.has(role)) filteredImages[role] = value
      }
      await startPlaygroundRun({
        modelId: selectedModel,
        providerId: selectedProvider,
        prompt,
        negativePrompt,
        imageInputs: filteredImages,
        output: outputValues,
        userParams: advancedValues as Record<string, number | string | boolean>,
      })
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const selectedProviderInfo = modelInfo?.providers.find((p) => p.id === selectedProvider)
  // Match the effect page: only gate on having an available provider. Required
  // fields are validated on click and surfaced inline, so the button stays
  // visible (just dimmed) and tells the user what's missing on attempt.
  const canGenerate = !!selectedProviderInfo?.is_available

  return (
    <>
      <RestoreFormBanner kind="playground" />
      <div ref={formRef} className="flex-1 space-y-6 overflow-y-auto p-5">
        <ModelSelector
          compatibleModels={compatibleModels}
          availableModels={availableModels}
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          onModelChange={setSelectedModel}
          onProviderChange={setSelectedProvider}
        />

        {/* Image inputs — driven by the model's supported roles. Required
            roles get a red asterisk; optional ones (e.g. end_frame) just
            show the label. */}
        {imageSlots.length > 0 && (
          <div className="space-y-4">
            {imageSlots.map((slot) => {
              const value = imageInputs[slot.key]
              return (
                <div key={slot.key} data-field-key={slot.key}>
                  <ImageUploader
                    label={humanizeRole(slot.key)}
                    required={slot.required}
                    error={!!fieldErrors[slot.key]}
                    value={value instanceof File ? value : null}
                    restoredUrl={typeof value === 'string' && value ? `/api/files/${value}/512.webp` : null}
                    onChange={(f) => {
                      handleImageChange(slot.key, f)
                      setFieldErrors((prev) => (prev[slot.key] ? { ...prev, [slot.key]: null } : prev))
                    }}
                  />
                </div>
              )
            })}
          </div>
        )}

        {/* Prompt */}
        <div className="space-y-2" data-field-key="prompt">
          <Label variant="form">Prompt<span className="text-destructive"> *</span></Label>
          <Textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              if (fieldErrors.prompt) setFieldErrors((prev) => ({ ...prev, prompt: null }))
            }}
            placeholder="Describe what you want to generate..."
            rows={4}
            error={!!fieldErrors.prompt}
          />
        </div>

        {/* Negative prompt */}
        <div className="space-y-2">
          <Label variant="form">Negative prompt</Label>
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
                value={outputValues[param.key] ?? param.default ?? ''}
                onChange={(v) => setOutputValues((prev) => ({ ...prev, [param.key]: v }))}
              />
            ))}
          </div>
        )}

        {/* Advanced */}
        {advancedParams.length > 0 && (
          <AdvancedSettings
            parameters={advancedParams}
            values={advancedValues}
            onChange={handleAdvancedChange}
          />
        )}

      </div>

      <div className="shrink-0 border-t p-4">
        {submitError && (
          <div className="mb-2 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <p className="flex-1">{submitError}</p>
            <button onClick={() => setSubmitError(null)} className="shrink-0 opacity-60 hover:opacity-100">
              <XIcon size={14} />
            </button>
          </div>
        )}
        <GenerateButton
          onClick={handleGenerate}
          disabled={!canGenerate}
          loading={isGenerating}
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

/* Renders a single output param (boolean/select/slider/number). Mirrors the helper inside EffectFormTab. */
function PlaygroundParamField({
  param,
  value,
  onChange,
}: {
  param: ModelParam
  value: string | number | boolean
  onChange: (v: string | number | boolean) => void
}) {
  const priceBadge = param.price_affecting
    ? <DollarBadge tooltip="Changing this value affects pricing" />
    : null

  if (param.type === 'boolean') {
    return (
      <div className="flex items-center gap-1">
        <Checkbox
          label={param.label ?? param.key}
          checked={value === true}
          onCheckedChange={(v) => onChange(v === true)}
        />
        {priceBadge}
      </div>
    )
  }

  if (param.type === 'select' && param.options) {
    return (
      <div className="space-y-2">
        <Label variant="form">{param.label}{priceBadge}</Label>
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
        <Label variant="form">{param.label}{priceBadge}</Label>
        <Input
          type="number"
          value={String(value)}
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
          <Label variant="form" className="mb-0">{param.label}{priceBadge}</Label>
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
