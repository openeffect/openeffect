import { useEffect, useMemo } from 'react'
import { Cloud, ChevronDown, Check, ArrowRight } from 'lucide-react'
import type { ModelInfo } from '@/types/api'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import { PricingBadge } from '@/components/PricingBadge'
import { cn } from '@/utils/cn'

interface ModelSelectorProps {
  compatibleModels: string[]
  availableModels: ModelInfo[]
  selectedModel: string
  selectedProvider: string
  onModelChange: (modelId: string) => void
  onProviderChange: (provider: string) => void
}

export function ModelSelector({
  compatibleModels,
  availableModels,
  selectedModel,
  selectedProvider,
  onModelChange,
  onProviderChange,
}: ModelSelectorProps) {
  const currentModelInfo = availableModels.find((m) => m.id === selectedModel)
  const providers = useMemo(() => currentModelInfo?.providers ?? [], [currentModelInfo])
  const selectedProviderInfo = providers.find((p) => p.id === selectedProvider)
  const hasMultipleProviders = providers.filter((p) => p.is_available).length > 1

  // Group compatible models by family (Wan / Kling / PixVerse …) and preserve
  // registry order within each family.
  const groups = useMemo(() => {
    const filtered = availableModels.filter((m) => compatibleModels.includes(m.id))
    const byGroup = new Map<string, ModelInfo[]>()
    for (const model of filtered) {
      const name = model.group || 'Other'
      if (!byGroup.has(name)) byGroup.set(name, [])
      byGroup.get(name)!.push(model)
    }
    return Array.from(byGroup.entries())
  }, [availableModels, compatibleModels])

  // Auto-pick the first available provider when the selected model changes
  // or when the current provider becomes invalid (unlikely today, but cheap).
  useEffect(() => {
    if (!currentModelInfo) return
    const stillValid = providers.some((p) => p.id === selectedProvider && p.is_available)
    if (!stillValid) {
      const first = providers.find((p) => p.is_available)
      if (first) onProviderChange(first.id)
      else if (providers.length > 0) onProviderChange(providers[0]!.id)
    }
  }, [selectedModel, currentModelInfo, providers, selectedProvider, onProviderChange])

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
            {currentModelInfo?.name ?? selectedModel}
            <ChevronDown size={12} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
          {groups.map(([groupName, models], gi) => (
            <div key={groupName}>
              {gi > 0 && <div className="my-1 border-t" />}
              {models.map((model) => {
                const isActive = selectedModel === model.id
                return (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => onModelChange(model.id)}
                    className={cn('flex items-start gap-2', isActive && 'bg-primary/5')}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isActive && <Check size={11} className="shrink-0 text-primary" />}
                        <span className={cn('font-medium', isActive && 'text-primary')}>{model.name}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                        {model.description}
                      </p>
                    </div>
                  </DropdownMenuItem>
                )
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Provider dropdown (shown only if there's more than one) */}
      {selectedProviderInfo && (
        <ArrowRight size={13} className="shrink-0 text-muted-foreground" />
      )}
      {selectedProviderInfo && hasMultipleProviders ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 text-xs text-secondary-foreground cursor-pointer hover:text-foreground">
              <Cloud size={12} />
              {selectedProviderInfo.name}
              <ChevronDown size={11} className="text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {providers.map((provider) => {
              const providerCost = provider.variants?.image_to_video?.cost
              return (
                <DropdownMenuItem
                  key={provider.id}
                  disabled={!provider.is_available}
                  onClick={() => { if (provider.is_available) onProviderChange(provider.id) }}
                  className={cn('justify-between', selectedProvider === provider.id && 'text-primary')}
                >
                  <div className="flex items-center gap-2">
                    <Cloud size={12} />
                    <span className="font-medium">{provider.name}</span>
                  </div>
                  {providerCost && <PricingBadge tooltip={providerCost} />}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : selectedProviderInfo ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Cloud size={12} />
          {selectedProviderInfo.name}
          {selectedProviderInfo.variants?.image_to_video?.cost && (
            <PricingBadge tooltip={selectedProviderInfo.variants.image_to_video.cost} />
          )}
        </span>
      ) : null}
    </div>
  )
}
