import { useState, useCallback, useEffect, useRef } from 'react'
import { X, MoreVertical, GitFork, Download, Pencil, Trash2 } from 'lucide-react'
import { useSelectedEffect, useEffectsStore } from '@/store/effectsStore'
import { useGenerationStore } from '@/store/generationStore'
import { useConfigStore } from '@/store/configStore'
import { useEditorStore } from '@/store/editorStore'
import { api } from '@/lib/api'
import { formatEffectType } from '@/lib/formatters'
import { EffectFormRenderer } from './EffectFormRenderer'
import { ModelSelector } from './ModelSelector'
import { AdvancedSettings } from './AdvancedSettings'
import { GenerateButton } from './GenerateButton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { GenerationRequest, ModelParam } from '@/types/api'

export function EffectPanel() {
  const selectedEffect = useSelectedEffect()
  const editorSavedManifest = useEditorStore((s) => s.savedManifest)
  const isEditorOpen = useEditorStore((s) => s.isEditorOpen)
  const editingEffectId = useEditorStore((s) => s.editingEffectId)
  const editorYaml = useEditorStore((s) => s.yamlContent)
  const editorLastSaved = useEditorStore((s) => s.lastSavedYaml)
  const manifest = isEditorOpen ? (editorSavedManifest ?? selectedEffect) : selectedEffect
  const selectEffect = useEffectsStore((s) => s.selectEffect)
  const startGeneration = useGenerationStore((s) => s.startGeneration)
  const restoredParams = useGenerationStore((s) => s.restoredParams)
  const availableModels = useConfigStore((s) => s.availableModels)

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [selectedModel, setSelectedModel] = useState(manifest?.generation?.default_model ?? '')
  const [selectedProvider, setSelectedProvider] = useState('')
  const [outputValues, setOutputValues] = useState<Record<string, string | number>>({})
  const [advancedValues, setAdvancedValues] = useState<Record<string, unknown>>({})
  const [isGenerating, setIsGenerating] = useState(false)

  // Get model params
  const modelInfo = availableModels.find((m) => m.id === selectedModel)
  const outputParams = modelInfo?.output_params ?? []
  const advancedParams = (modelInfo?.advanced_params ?? []).map((p) => {
    // Apply manifest default overrides
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
    setAdvancedValues({})  // reset so manifest defaults apply for the new model

    // Auto-select first available provider for the new model
    if (modelInfo) {
      const firstAvailable = modelInfo.providers.find((p) => p.is_available)
      setSelectedProvider(firstAvailable?.id ?? modelInfo.providers[0]?.id ?? '')
    }
  }, [selectedModel, outputParams, modelInfo])

  // Track effect changes -- keep matching fields, reset the rest
  const prevEffectId = useRef(manifest?.id)
  useEffect(() => {
    if (!manifest || manifest.id === prevEffectId.current) return
    prevEffectId.current = manifest.id

    setValues((prev) => {
      const next: Record<string, unknown> = {}
      for (const [key, schema] of Object.entries(manifest?.inputs ?? {})) {
        if (key in prev && prev[key] != null) {
          next[key] = prev[key]
        }
        if (!(key in next) && schema.type === 'select' && 'default' in schema) {
          next[key] = schema.default
        }
      }
      return next
    })

    setSelectedModel((prev) =>
      manifest?.generation?.models.includes(prev) ? prev : manifest?.generation?.default_model
    )
    setAdvancedValues((prev) => {
      const validKeys = new Set((modelInfo?.advanced_params ?? []).map((p) => p.key))
      const next: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(prev)) {
        if (validKeys.has(key)) next[key] = val
      }
      return next
    })
  }, [manifest])

  // Consume restoredParams
  useEffect(() => {
    if (!restoredParams || !manifest) return

    setSelectedModel(
      restoredParams.modelId && manifest?.generation?.models.includes(restoredParams.modelId)
        ? restoredParams.modelId
        : manifest?.generation?.default_model
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

    setAdvancedValues(restoredParams.userParams ?? {})
    useGenerationStore.setState({ restoredParams: null })
  }, [restoredParams, manifest])

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Auto-detect aspect ratio from uploaded image (if model supports aspect_ratio param)
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

  if (!manifest) return null

  const fullId = `${manifest.namespace}/${manifest.id}`

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      const inputs: Record<string, string> = {}
      for (const [key, schema] of Object.entries(manifest?.inputs ?? {})) {
        if (schema.type === 'image') {
          const val = values[key]
          if (val instanceof File) {
            const uploaded = await api.upload(val)
            inputs[key] = uploaded.ref_id
          } else if (val && typeof val === 'object' && '__restored' in (val as Record<string, unknown>)) {
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
        model_id: selectedModel || manifest?.generation?.default_model,
        provider_id: selectedProvider,
        inputs,
        output: outputValues,
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

  // Check if the selected provider is available
  const selectedProviderInfo = modelInfo?.providers.find((p) => p.id === selectedProvider)
  const editorDirty = isEditorOpen && editorYaml !== editorLastSaved
  const editorUnsaved = isEditorOpen && !editingEffectId
  const canGenerate = selectedProviderInfo?.is_available === true && !editorDirty && !editorUnsaved

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-bold text-foreground">
              {manifest.name}
            </h2>
            <Badge variant="accent" className="shrink-0 font-semibold uppercase tracking-wider">
              {formatEffectType(manifest.type)}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {manifest.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 ml-2">
          {!(isEditorOpen && !editingEffectId) && <EffectMenu effect={manifest} />}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (isEditorOpen) {
                if (!useEditorStore.getState().confirmClose()) return
                useEditorStore.getState().closeEditor()
              }
              selectEffect(null)
            }}
          >
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Form body */}
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <ModelSelector
          models={manifest?.generation?.models ?? []}
          availableModels={availableModels}
          selectedModel={selectedModel || manifest?.generation?.default_model}
          selectedProvider={selectedProvider}
          onModelChange={setSelectedModel}
          onProviderChange={setSelectedProvider}
        />
        <EffectFormRenderer manifest={manifest} values={values} onChange={handleChange} />

        {/* Model-driven output params */}
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

        {/* Model-driven advanced settings */}
        {advancedParams.length > 0 && (
          <AdvancedSettings
            parameters={advancedParams}
            values={advancedValues}
            onChange={handleAdvancedChange}
            manifestDefaults={manifest?.generation?.defaults}
          />
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

/* ─── Three-dot menu for Fork / Edit / Export ─── */
function EffectMenu({ effect }: { effect: import('@/types/api').EffectManifest }) {
  const forkEffect = useEditorStore((s) => s.forkEffect)
  const selectEffect = useEffectsStore((s) => s.selectEffect)
  const loadEffects = useEffectsStore((s) => s.loadEffects)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isLocal = effect.source === 'local'
  const canDelete = effect.source !== 'official'

  const handleFork = () => forkEffect(effect)

  const handleEdit = async () => {
    const fullId = `${effect.namespace}/${effect.id}`
    try {
      const { yaml, files } = await api.getEffectEditorData(effect.namespace, effect.id)
      useEditorStore.getState().openEditor(yaml, fullId, effect, files)
    } catch {
      forkEffect(effect)
    }
  }

  const handleExport = () => {
    window.open(api.exportEffect(effect.namespace, effect.id), '_blank')
  }

  const handleDelete = async () => {
    try {
      await api.uninstallEffect(effect.namespace, effect.id)
      useEditorStore.getState().closeEditor()
      selectEffect(null)
      await loadEffects()
    } catch {
      // ignore
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmDelete(false) }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreVertical size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleFork}>
          <GitFork size={14} />
          Fork
        </DropdownMenuItem>
        {isLocal && (
          <DropdownMenuItem onClick={handleEdit}>
            <Pencil size={14} />
            Edit
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleExport}>
          <Download size={14} />
          Export
        </DropdownMenuItem>
        {canDelete && (
          confirmDelete ? (
            <DropdownMenuItem onClick={handleDelete} className="text-destructive hover:bg-destructive/15">
              <Trash2 size={14} />
              Confirm delete
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={(e) => { e.preventDefault(); setConfirmDelete(true) }} className="text-destructive">
              <Trash2 size={14} />
              Delete
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
