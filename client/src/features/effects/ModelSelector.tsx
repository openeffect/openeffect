import { useEffect } from 'react'
import { Cloud, ChevronRight, ChevronDown } from 'lucide-react'
import type { ModelInfo } from '@/types/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface ModelSelectorProps {
  models: string[]
  availableModels: ModelInfo[]
  selectedModel: string
  selectedProvider: string
  onModelChange: (model: string) => void
  onProviderChange: (provider: string) => void
}

const MODEL_LABELS: Record<string, string> = {
  'wan-2.2': 'Wan 2.2',
  'kling-v3': 'Kling v3',
}

export function ModelSelector({
  models,
  availableModels,
  selectedModel,
  selectedProvider,
  onModelChange,
  onProviderChange,
}: ModelSelectorProps) {
  const filteredModels = availableModels.filter((m) => models.includes(m.id))
  const currentModelInfo = availableModels.find((m) => m.id === selectedModel)
  const providers = currentModelInfo?.providers ?? []
  const selectedProviderInfo = providers.find((p) => p.id === selectedProvider)
  const hasMultipleProviders = providers.filter((p) => p.is_available).length > 1

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

  return (
    <div className="flex items-center gap-2">
      {/* Model pills */}
      {filteredModels.map((model) => {
        const isActive = selectedModel === model.id
        return (
          <Button
            key={model.id}
            onClick={() => onModelChange(model.id)}
            variant={isActive ? 'default' : 'outline'}
            size="sm"
          >
            {MODEL_LABELS[model.id] ?? model.name}
          </Button>
        )
      })}

      {/* Arrow */}
      {selectedProviderInfo && (
        <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
      )}

      {/* Provider dropdown */}
      {selectedProviderInfo && hasMultipleProviders && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 text-xs text-secondary-foreground cursor-pointer hover:text-foreground">
              <Cloud size={12} />
              {selectedProviderInfo.name}
              {selectedProviderInfo.cost && (
                <span className="text-muted-foreground">{selectedProviderInfo.cost}</span>
              )}
              <ChevronDown size={11} className="text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {providers.map((provider) => {
              const isActive = selectedProvider === provider.id
              return (
                <DropdownMenuItem
                  key={provider.id}
                  disabled={!provider.is_available}
                  onClick={() => {
                    if (provider.is_available) {
                      onProviderChange(provider.id)
                    }
                  }}
                  className={cn(isActive && 'text-primary')}
                >
                  <Cloud size={12} />
                  <div>
                    <div className="font-medium">{provider.name}</div>
                    {provider.cost && (
                      <div className="text-[10px] opacity-60">{provider.cost}</div>
                    )}
                  </div>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Provider text (no dropdown needed when single provider) */}
      {selectedProviderInfo && !hasMultipleProviders && (
        <span className="flex items-center gap-1 text-xs text-secondary-foreground">
          <Cloud size={12} />
          {selectedProviderInfo.name}
          {selectedProviderInfo.cost && (
            <span className="text-muted-foreground">{selectedProviderInfo.cost}</span>
          )}
        </span>
      )}
    </div>
  )
}
