import { useEffect } from 'react'
import { Cloud, Monitor } from 'lucide-react'
import type { ModelInfo, ModelProvider } from '@/types/api'

interface ModelSelectorProps {
  models: string[]               // supported model IDs from manifest
  availableModels: ModelInfo[]   // from config store
  selectedModel: string
  selectedProvider: string
  onModelChange: (model: string) => void
  onProviderChange: (provider: string) => void
}

const MODEL_LABELS: Record<string, string> = {
  'wan-2.2': 'Wan 2.2',
  'kling-v3': 'Kling v3',
}

function ProviderIcon({ type }: { type: 'cloud' | 'local' }) {
  return type === 'cloud' ? <Cloud size={12} /> : <Monitor size={12} />
}

export function ModelSelector({
  models,
  availableModels,
  selectedModel,
  selectedProvider,
  onModelChange,
  onProviderChange,
}: ModelSelectorProps) {
  // Filter availableModels to only those supported by the manifest
  const filteredModels = availableModels.filter((m) => models.includes(m.id))

  // Get providers for the currently selected model
  const currentModelInfo = availableModels.find((m) => m.id === selectedModel)
  const providers = currentModelInfo?.providers ?? []

  // Auto-select first available provider when model changes
  useEffect(() => {
    if (!currentModelInfo) return
    const currentProviderStillValid = providers.some(
      (p) => p.id === selectedProvider && p.is_available
    )
    if (!currentProviderStillValid) {
      const firstAvailable = providers.find((p) => p.is_available)
      if (firstAvailable) {
        onProviderChange(firstAvailable.id)
      } else if (providers.length > 0) {
        onProviderChange(providers[0]!.id)
      }
    }
  }, [selectedModel, currentModelInfo, providers, selectedProvider, onProviderChange])

  return (
    <div className="flex items-start gap-5">
      {/* Model pills */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
          Model
        </label>
        <div className="flex flex-wrap gap-1.5">
          {filteredModels.map((model) => {
            const isActive = selectedModel === model.id
            return (
              <button
                key={model.id}
                onClick={() => onModelChange(model.id)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                style={{
                  background: isActive ? 'var(--accent)' : 'var(--surface-elevated)',
                  color: isActive ? 'white' : 'var(--text-secondary)',
                  border: isActive ? '1px solid transparent' : '1px solid var(--border)',
                  boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {MODEL_LABELS[model.id] ?? model.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Provider pills */}
      {providers.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Run on
          </label>
          <div className="flex flex-wrap gap-1.5">
            {providers.map((provider) => (
              <ProviderPill
                key={provider.id}
                provider={provider}
                isSelected={selectedProvider === provider.id}
                onSelect={() => {
                  if (provider.is_available) onProviderChange(provider.id)
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProviderPill({
  provider,
  isSelected,
  onSelect,
}: {
  provider: ModelProvider
  isSelected: boolean
  onSelect: () => void
}) {
  if (!provider.is_available) {
    return (
      <button
        disabled
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium opacity-40"
        style={{
          background: 'var(--surface-elevated)',
          color: 'var(--text-tertiary)',
          border: '1px solid var(--border)',
          cursor: 'not-allowed',
        }}
      >
        <ProviderIcon type={provider.type} />
        {provider.name}
      </button>
    )
  }

  return (
    <button
      onClick={onSelect}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
      style={{
        background: isSelected ? 'var(--accent)' : 'var(--surface-elevated)',
        color: isSelected ? 'white' : 'var(--text-secondary)',
        border: isSelected ? '1px solid transparent' : '1px solid var(--border)',
        boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
      }}
    >
      <ProviderIcon type={provider.type} />
      {provider.name}
      {provider.cost && (
        <span
          className="text-[10px] opacity-70"
          style={{ color: isSelected ? 'white' : 'var(--text-tertiary)' }}
        >
          {provider.cost}
        </span>
      )}
    </button>
  )
}
