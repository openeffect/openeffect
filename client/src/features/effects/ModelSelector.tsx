import { useEffect, useMemo } from 'react'
import { Cloud, ChevronDown, Check, ArrowRight } from 'lucide-react'
import type { ModelInfo } from '@/types/api'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/utils/cn'

interface ModelSelectorProps {
  compatibleModels: string[]
  availableModels: ModelInfo[]
  selectedModel: string
  selectedProvider: string
  onModelChange: (model: string) => void
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
  const filteredModels = availableModels.filter((m) => compatibleModels.includes(m.id))
  const currentModelInfo = availableModels.find((m) => m.id === selectedModel)
  const providers = currentModelInfo?.providers ?? []
  const selectedProviderInfo = providers.find((p) => p.id === selectedProvider)
  const hasMultipleProviders = providers.filter((p) => p.is_available).length > 1

  // Group models by family
  const groups = useMemo(() => {
    const map = new Map<string, ModelInfo[]>()
    for (const model of filteredModels) {
      const group = model.group || 'Other'
      if (!map.has(group)) map.set(group, [])
      map.get(group)!.push(model)
    }
    return Array.from(map.entries())
  }, [filteredModels])

  // Auto-select first available provider when model changes
  useEffect(() => {
    if (!currentModelInfo) return
    const stillValid = providers.some((p) => p.id === selectedProvider && p.is_available)
    if (!stillValid) {
      const first = providers.find((p) => p.is_available)
      if (first) onProviderChange(first.id)
      else if (providers.length > 0) onProviderChange(providers[0]!.id)
    }
  }, [selectedModel, currentModelInfo, providers, selectedProvider, onProviderChange])

  const cost = selectedProviderInfo?.cost

  return (
    <div className="flex items-center gap-2">
      {/* Model dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
            {currentModelInfo?.name ?? selectedModel}
            <ChevronDown size={12} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-72 overflow-y-auto">
          {groups.map(([groupName, models], gi) => (
            <div key={groupName}>
              {gi > 0 && <div className="my-1 border-t" />}
              {models.map((model) => {
                const isActive = selectedModel === model.id
                const modelCost = model.providers[0]?.cost
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
                    {modelCost && (
                      <span className="shrink-0 text-[10px] text-muted-foreground mt-0.5">
                        {modelCost}
                      </span>
                    )}
                  </DropdownMenuItem>
                )
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Arrow + provider */}
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
            {providers.map((provider) => (
              <DropdownMenuItem
                key={provider.id}
                disabled={!provider.is_available}
                onClick={() => { if (provider.is_available) onProviderChange(provider.id) }}
                className={cn(selectedProvider === provider.id && 'text-primary')}
              >
                <Cloud size={12} />
                <div>
                  <div className="font-medium">{provider.name}</div>
                  {provider.cost && <div className="text-[10px] opacity-60">{provider.cost}</div>}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : selectedProviderInfo ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Cloud size={12} />
          {selectedProviderInfo.name}
          {cost && <span>{cost}</span>}
        </span>
      ) : null}
    </div>
  )
}
