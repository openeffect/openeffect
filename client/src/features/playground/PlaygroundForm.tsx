import { useRef, useState } from 'react'
import { useStore, setState } from '@/store'
import { selectAvailableModels } from '@/store/selectors/configSelectors'
import { selectRestoredParams } from '@/store/selectors/runSelectors'
import { startPlaygroundRun } from '@/store/actions/playgroundActions'
import {
  mutateClearCarriedImage,
  mutateSetCarriedImage,
  mutateSetCarriedModel,
  mutateSetCarriedParam,
  mutateSetCarriedPlaygroundNegativePrompt,
  mutateSetCarriedPlaygroundPrompt,
} from '@/store/mutations/formCarryMutations'
import { isValidParamValue } from '@/utils/formCarry'
import { api } from '@/utils/api'
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

  // Playground has no manifest, so the user's last-picked model from the
  // carry slice is always preferred (when it's actually a known model).
  // Falls back to the first available model on a fresh session.
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const carriedModel = useStore.getState().formCarry.lastModelId
    if (carriedModel && availableModels.some((m) => m.id === carriedModel)) {
      return carriedModel
    }
    return availableModels[0]?.id || ''
  })
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  // Hydrate from carry so navigating away from the playground (to an
  // effect / settings / history) and back preserves what was typed.
  // restoredParams ("Open in Playground" / "Try in Playground") still
  // overrides further down the render — those are explicit "load this"
  // intents, not a session continuation.
  const [prompt, setPrompt] = useState(
    () => useStore.getState().formCarry.lastPlaygroundPrompt,
  )
  const [negativePrompt, setNegativePrompt] = useState(
    () => useStore.getState().formCarry.lastPlaygroundNegativePrompt,
  )
  // Seed image inputs from the cross-effect carry slice. Keys are roles
  // (`start_frame`, `end_frame`, `reference`); values are either `File` (not
  // yet uploaded) or `file_id` strings. Roles incompatible with the selected
  // model are filtered out by the seed-defaults block below when the model
  // changes.
  const [imageInputs, setImageInputs] = useState<Record<string, File | string>>(
    () => ({ ...useStore.getState().formCarry.lastImagesByRole }),
  )
  const [outputValues, setOutputValues] = useState<Record<string, string | number | boolean>>({})
  const [advancedValues, setAdvancedValues] = useState<Record<string, unknown>>({})
  const [isGenerating, setIsGenerating] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({})
  // Roles whose eager upload is in flight. Drives the per-cell busy state
  // and disables Generate while non-empty.
  const [uploadingRoles, setUploadingRoles] = useState<ReadonlySet<string>>(new Set())
  // Per-role upload error messages. Surfaces under the ImageUploader as
  // small destructive text — same shape as asset/zip-install error UX.
  const [uploadErrors, setUploadErrors] = useState<Record<string, string | undefined>>({})
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
  // "skip this cycle" sentinel that the restore handler sets explicitly
  // when applying restoredParams — that's how it tells this block "the
  // values are already populated, don't overwrite them." The lazy init
  // mirrors the current `${selectedModel}|${selectedProvider}` pair (with
  // an empty provider on first mount) so once the ModelSelector
  // auto-picks a provider, the seed block runs once with skip=false and
  // applies the carry-aware defaults below.
  const [prevSeedKey, setPrevSeedKey] = useState<string>(
    () => `${selectedModel}|${selectedProvider}`,
  )
  if (selectedModel && selectedProvider) {
    const seedKey = `${selectedModel}|${selectedProvider}`
    if (seedKey !== prevSeedKey) {
      const skip = prevSeedKey === ''
      setPrevSeedKey(seedKey)
      if (!skip) {
        // Carry-aware seeding: prefer the user's last-tweaked model param
        // value (when valid for this variant) over the variant's default.
        const paramCarry = useStore.getState().formCarry.lastModelParams
        const defaults: Record<string, string | number | boolean> = {}
        for (const param of outputParams) {
          const carried = paramCarry[param.key]
          if (carried !== undefined && isValidParamValue(carried, param)) {
            defaults[param.key] = carried
            continue
          }
          if (param.default !== undefined) defaults[param.key] = param.default
        }
        setOutputValues(defaults)
        const advancedDefaults: Record<string, unknown> = {}
        for (const param of advancedParams) {
          const carried = paramCarry[param.key]
          if (carried !== undefined && isValidParamValue(carried, param)) {
            advancedDefaults[param.key] = carried
          }
        }
        setAdvancedValues(advancedDefaults)
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
        // Mirror to carry — applied = "current pick."
        setState((s) => mutateSetCarriedModel(s, restoredModel.id), 'formCarry/setModel')
      }
      setPrevSeedKey('')

      // Pull prompt + negative_prompt; everything else is a role-keyed image ref
      const inputs = restoredParams.inputs ?? {}
      const nextImages: Record<string, string> = {}
      let restoredPrompt = ''
      let restoredNegative = ''
      for (const [key, value] of Object.entries(inputs)) {
        if (key === 'prompt') restoredPrompt = String(value ?? '')
        else if (key === 'negative_prompt') restoredNegative = String(value ?? '')
        else if (typeof value === 'string' && value) nextImages[key] = value
      }
      setPrompt(restoredPrompt)
      setNegativePrompt(restoredNegative)
      // Mirror restored prompts into carry so the "current" playground
      // state is what survives a nav-away-and-back, not whatever was
      // typed before the restore.
      setState((s) => mutateSetCarriedPlaygroundPrompt(s, restoredPrompt), 'formCarry/setPrompt')
      setState((s) => mutateSetCarriedPlaygroundNegativePrompt(s, restoredNegative), 'formCarry/setNegativePrompt')
      // Merge instead of replace: roles explicitly in `restoredParams` override,
      // but roles that were already in the form (typically seeded from the
      // cross-effect carry slice when the user clicked "Try in Playground"
      // from an effect with images) are preserved. Without this merge, the
      // carry-seeded images would be wiped on every restore even when the
      // restored shape contains no images at all (the "Try in Playground"
      // case where only prompt + negative are populated).
      setImageInputs((prev) => ({ ...prev, ...nextImages }))
      // Mirror restored role-keyed images into the carry slice — same intent
      // as a fresh upload, just sourced from a historical run.
      for (const [role, value] of Object.entries(nextImages)) {
        setState((s) => mutateSetCarriedImage(s, role, value), 'formCarry/setImage')
      }

      // Split the flat restored `params` back into the form's two visual
      // buckets using the model variant's schema. Anything not in `mainParams`
      // falls into `advancedValues` so unknown keys still round-trip.
      const restoredVariant = providerVariant(
        restoredModel ?? availableModels.find((m) => m.id === selectedModel),
        selectedProvider,
        VARIANT_KEY,
      )
      const mainKeys = new Set(mainParams(restoredVariant).map((p) => p.key))
      const main: Record<string, string | number | boolean> = {}
      const advanced: Record<string, string | number | boolean> = {}
      for (const [key, value] of Object.entries(restoredParams.params ?? {})) {
        if (mainKeys.has(key)) main[key] = value
        else advanced[key] = value
        setState((s) => mutateSetCarriedParam(s, key, value), 'formCarry/setParam')
      }
      setOutputValues(main)
      setAdvancedValues(advanced)
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
    if (!file) {
      setState((s) => mutateClearCarriedImage(s, role), 'formCarry/clearImage')
      // Hide the busy spinner if a pending upload was in flight.
      setUploadingRoles((prev) => {
        if (!prev.has(role)) return prev
        const next = new Set(prev)
        next.delete(role)
        return next
      })
      setUploadErrors((prev) => (prev[role] !== undefined ? { ...prev, [role]: undefined } : prev))
      return
    }
    // Re-picking clears any prior failed-upload error.
    setUploadErrors((prev) => (prev[role] !== undefined ? { ...prev, [role]: undefined } : prev))
    // Hold the File in carry immediately so a fast effect-switch sees it.
    setState((s) => mutateSetCarriedImage(s, role, file), 'formCarry/setImage')
    setUploadingRoles((prev) => {
      const next = new Set(prev)
      next.add(role)
      return next
    })
    const finishUpload = () => {
      setUploadingRoles((prev) => {
        if (!prev.has(role)) return prev
        const next = new Set(prev)
        next.delete(role)
        return next
      })
    }
    // Eagerly upload, then swap form state and carry to the file_id so
    // subsequent renders use the 512.webp thumbnail instead of decoding the
    // full File on every effect switch. Server-side sha256 dedup makes a
    // re-upload a no-op if the run flow races us.
    void api.uploadFile(file)
      .then((uploaded) => {
        setImageInputs((prev) => prev[role] === file ? { ...prev, [role]: uploaded.id } : prev)
        setState((s) => {
          if (s.formCarry.lastImagesByRole[role] === file) {
            mutateSetCarriedImage(s, role, uploaded.id)
          }
        }, 'formCarry/imageUploaded')
      })
      .catch((err) => {
        // Match the asset / zip-install error pattern: clear the cell
        // (form state + carry) and surface the error inline so the user
        // can re-pick.
        const msg = err instanceof Error ? err.message : 'Upload failed'
        setUploadErrors((prev) => ({ ...prev, [role]: msg }))
        setImageInputs((prev) => {
          if (prev[role] !== file) return prev
          const next = { ...prev }
          delete next[role]
          return next
        })
        setState((s) => {
          if (s.formCarry.lastImagesByRole[role] === file) {
            mutateClearCarriedImage(s, role)
          }
        }, 'formCarry/clearImage')
      })
      .finally(finishUpload)
  }

  const handleAdvancedChange = (key: string, value: unknown) => {
    setAdvancedValues((prev) => ({ ...prev, [key]: value }))
    // Mirror canonical-keyed model param tweaks into carry.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      setState((s) => mutateSetCarriedParam(s, key, value), 'formCarry/setParam')
    }
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
  const isAnyUploading = uploadingRoles.size > 0
  // Match the effect page: only gate on having an available provider. Required
  // fields are validated on click and surfaced inline, so the button stays
  // visible (just dimmed) and tells the user what's missing on attempt.
  // Also gated on in-flight uploads so the run never races a half-uploaded image.
  const canGenerate = !!selectedProviderInfo?.is_available && !isAnyUploading

  return (
    <>
      <RestoreFormBanner kind="playground" />
      <div ref={formRef} className="flex-1 space-y-6 overflow-y-auto p-5">
        <ModelSelector
          compatibleModels={compatibleModels}
          availableModels={availableModels}
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          onModelChange={(id) => {
            setSelectedModel(id)
            setState((s) => mutateSetCarriedModel(s, id), 'formCarry/setModel')
          }}
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
                    uploading={uploadingRoles.has(slot.key)}
                    errorMessage={uploadErrors[slot.key] ?? null}
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
              const v = e.target.value
              setPrompt(v)
              setState((s) => mutateSetCarriedPlaygroundPrompt(s, v), 'formCarry/setPrompt')
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
            onChange={(e) => {
              const v = e.target.value
              setNegativePrompt(v)
              setState((s) => mutateSetCarriedPlaygroundNegativePrompt(s, v), 'formCarry/setNegativePrompt')
            }}
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
                onChange={(v) => {
                  setOutputValues((prev) => ({ ...prev, [param.key]: v }))
                  setState((s) => mutateSetCarriedParam(s, param.key, v), 'formCarry/setParam')
                }}
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
        <GenerateButton
          onClick={handleGenerate}
          disabled={!canGenerate}
          loading={isGenerating}
        />
        {submitError ? (
          <p className="mt-2 text-center text-[11px] text-destructive">{submitError}</p>
        ) : isAnyUploading ? (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Waiting for upload to finish…
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
