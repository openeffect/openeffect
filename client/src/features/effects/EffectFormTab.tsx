import { useState, useEffect, useRef } from 'react'
import { AlertCircle, ChevronDown, X as XIcon } from 'lucide-react'
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
import {
  effectAdvancedParams,
  effectMainParams,
  lockedKeys,
  paramDefault,
  providerVariant,
} from '@/utils/modelParams'
import { EffectFormRenderer } from './EffectFormRenderer'
import { EffectFormField } from './EffectFormField'
import { Checkbox } from '@/components/ui/Checkbox'
import { DollarBadge } from '@/components/DollarBadge'
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

  // compatible_models is computed server-side from role compatibility ∩
  // generation.models. For unsaved effects (blank editor) it's empty, so
  // fall back to the authored generation.models list.
  const compatibleModels = (manifest?.compatible_models?.length
    ? manifest.compatible_models
    : manifest?.generation?.models) ?? []
  const defaultModel = manifest?.generation?.default_model || compatibleModels[0] || ''
  // Only one variant exists today. Kept as a constant so re-adding v2v later
  // is a one-line change.
  const variantKey = 'image_to_video'

  // Initialize form values from manifest at mount. Parent remounts this
  // component via `key` whenever manifest changes, so lazy init is sufficient.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    if (!manifest) return {}
    const init: Record<string, unknown> = {}
    for (const [key, schema] of Object.entries(manifest.inputs ?? {})) {
      if (schema.type === 'select' && 'default' in schema) init[key] = schema.default
    }
    return init
  })
  const [selectedModel, setSelectedModel] = useState(defaultModel)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [outputValues, setOutputValues] = useState<Record<string, string | number | boolean>>({})
  const [advancedValues, setAdvancedValues] = useState<Record<string, unknown>>({})
  const [isGenerating, setIsGenerating] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  // Get model params for the active (provider, variant), filtering out
  // keys locked by the manifest.
  const modelInfo = availableModels.find((m) => m.id === selectedModel)
  const variant = providerVariant(modelInfo, selectedProvider, variantKey)

  const locked = manifest ? lockedKeys(manifest, selectedModel) : new Set<string>()
  const outputParams = effectMainParams(variant).filter((p) => !locked.has(p.key))
  const advancedParams = effectAdvancedParams(variant)
    .filter((p) => !locked.has(p.key))
    .map((p) => {
      const v = manifest ? paramDefault(manifest, selectedModel, p.key) : undefined
      return v !== undefined ? { ...p, default: v } : p
    })

  // Auto-select first available provider when model changes. Render-time
  // prev-state comparison instead of useEffect so we don't trigger a
  // cascading render (React's "storing info from previous renders" pattern).
  const [prevModel, setPrevModel] = useState(selectedModel)
  if (selectedModel !== prevModel) {
    setPrevModel(selectedModel)
    if (modelInfo) {
      const firstAvailable = modelInfo.providers.find((p) => p.is_available)
      setSelectedProvider(firstAvailable?.id ?? modelInfo.providers[0]?.id ?? '')
    }
  }

  // Re-seed output + advanced values whenever (model, provider) changes —
  // the provider-variant's params list (and defaults) may differ. An empty
  // prevSeedKey acts as a "skip this cycle" sentinel so the restore handler
  // doesn't get its freshly-set values overwritten.
  const [prevSeedKey, setPrevSeedKey] = useState(`${selectedModel}|${selectedProvider}`)
  const seedKey = `${selectedModel}|${selectedProvider}`
  if (seedKey !== prevSeedKey) {
    const skip = prevSeedKey === ''
    setPrevSeedKey(seedKey)
    if (!skip) {
      const defaults: Record<string, string | number | boolean> = {}
      for (const param of outputParams) {
        const v = manifest ? paramDefault(manifest, selectedModel, param.key) : undefined
        const fallback = v ?? param.default
        if (fallback !== undefined) defaults[param.key] = fallback
      }
      setOutputValues(defaults)
      setAdvancedValues({})
    }
  }

  // Consume restoredParams when the store pushes a new value (Reuse button on
  // a historical run). Render-time prev-state comparison for the same reason
  // as the provider auto-select above — avoid cascading renders from setState
  // inside useEffect. Sentinel `undefined` init (restoredParams is never
  // undefined) so the first render's comparison fires — otherwise a value
  // seeded into the store before mount would match its own
  // `useState(restoredParams)` and the restore block would be skipped.
  const [prevRestored, setPrevRestored] = useState<typeof restoredParams | undefined>(undefined)
  if (prevRestored !== restoredParams) {
    setPrevRestored(restoredParams)
    if (restoredParams && manifest) {
      setSelectedModel(
        restoredParams.modelId && compatibleModels.includes(restoredParams.modelId)
          ? restoredParams.modelId
          : defaultModel
      )
      // Tell the seed-defaults block to skip this cycle — otherwise it would
      // overwrite the restored output/advanced values on the next render.
      setPrevSeedKey('')

      if (restoredParams.output) {
        setOutputValues(restoredParams.output as Record<string, string | number>)
      }

      const next: Record<string, unknown> = {}
      if (restoredParams.inputs) {
        for (const [key, schema] of Object.entries(manifest.inputs ?? {})) {
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
    }
  }

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: null } : prev))
  }

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

  const handleAdvancedChange = (key: string, value: unknown) => {
    setAdvancedValues((prev) => ({ ...prev, [key]: value }))
  }

  // Compute unmatched restored inputs
  const unmatchedInputs = (() => {
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
  })()

  // Advanced manifest inputs (hidden from main form, shown in advanced section)
  const advancedInputs = Object.entries(manifest?.inputs ?? {}).filter(([_, s]) => s.advanced)

  if (!manifest) return null

  const handleGenerate = async () => {
    // Validate required manifest inputs (image + text) before hitting the API
    const errors: Record<string, string | null> = {}
    for (const [key, schema] of Object.entries(manifest.inputs ?? {})) {
      if (!schema.required) continue
      const val = values[key]
      if (schema.type === 'image') {
        const hasImage = val instanceof File || (val && typeof val === 'object' && '__restored' in val)
        if (!hasImage) errors[key] = `Please upload ${schema.label.toLowerCase()}`
      } else if (schema.type === 'text') {
        if (!val || typeof val !== 'string' || !val.trim()) errors[key] = `${schema.label} is required`
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setSubmitError(null)
      // Scroll the first errored field into view on the next frame so the
      // red border + message are actually visible if the field is offscreen.
      requestAnimationFrame(() => {
        const firstKey = Object.keys(errors)[0]
        const el = formRef.current?.querySelector(`[data-field-key="${firstKey}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return
    }

    setFieldErrors({})
    setSubmitError(null)
    setIsGenerating(true)
    try {
      await startRun(
        manifest,
        values,
        selectedModel || defaultModel,
        selectedProvider,
        outputValues,
        advancedValues,
      )
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Run failed')
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
      <div ref={formRef} className="flex-1 space-y-6 overflow-y-auto p-5">
        <ModelSelector
          compatibleModels={compatibleModels}
          availableModels={availableModels}
          selectedModel={selectedModel || defaultModel}
          selectedProvider={selectedProvider}
          onModelChange={setSelectedModel}
          onProviderChange={setSelectedProvider}
        />
        <EffectFormRenderer manifest={manifest} values={values} errors={fieldErrors} onChange={handleChange} />

        {outputParams.length > 0 && (
          <div className="space-y-5">
            {outputParams.map((param) => (
              <ModelParamField
                key={param.key}
                param={param}
                value={outputValues[param.key] ?? param.default ?? ''}
                onChange={(v) => setOutputValues((prev) => ({ ...prev, [param.key]: v }))}
              />
            ))}
          </div>
        )}

        {(advancedParams.length > 0 || advancedInputs.length > 0) && (
          <AdvancedSettings
            parameters={advancedParams}
            values={advancedValues}
            onChange={handleAdvancedChange}
          >
            {advancedInputs.map(([key, schema]) => (
              <EffectFormField key={key} schema={schema} value={values[key]} onChange={(v) => handleChange(key, v)} />
            ))}
          </AdvancedSettings>
        )}

        {unmatchedInputs.length > 0 && (
          <PreviousParams items={unmatchedInputs} />
        )}
      </div>

      {/* Footer */}
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
        <GenerateButton onClick={handleGenerate} disabled={!canGenerate} loading={isGenerating} />
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

/* --- Renders a single model parameter (select/number/slider/boolean) --- */

function ModelParamField({
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
                    src={`/api/files/${value}/512.webp`}
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
