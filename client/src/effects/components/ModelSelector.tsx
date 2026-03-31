import { useEffect, useRef, useState } from 'react'
import { Cloud, Monitor, ChevronRight, ChevronDown } from 'lucide-react'
import type { ModelInfo, ModelProvider } from '@/types/api'

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

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  // Close dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  return (
    <div className="flex items-center gap-2">
      {/* Model pills */}
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
            }}
          >
            {MODEL_LABELS[model.id] ?? model.name}
          </button>
        )
      })}

      {/* Arrow */}
      {selectedProviderInfo && (
        <ChevronRight size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
      )}

      {/* Provider text + dropdown */}
      {selectedProviderInfo && (
        <div className="relative" ref={dropdownRef}>
          <span
            onClick={hasMultipleProviders ? () => setDropdownOpen(!dropdownOpen) : undefined}
            className="flex items-center gap-1 text-xs"
            style={{
              color: 'var(--text-secondary)',
              cursor: hasMultipleProviders ? 'pointer' : 'default',
            }}
          >
            {selectedProviderInfo.type === 'cloud' ? <Cloud size={12} /> : <Monitor size={12} />}
            {selectedProviderInfo.name}
            {selectedProviderInfo.cost && (
              <span style={{ color: 'var(--text-tertiary)' }}>{selectedProviderInfo.cost}</span>
            )}
            {hasMultipleProviders && <ChevronDown size={11} style={{ color: 'var(--text-tertiary)' }} />}
          </span>

          {dropdownOpen && (
            <div
              className="absolute left-0 top-full z-50 mt-1.5 min-w-[160px] overflow-hidden rounded-lg py-1"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
              }}
            >
              {providers.map((provider) => {
                const isActive = selectedProvider === provider.id
                return (
                  <button
                    key={provider.id}
                    disabled={!provider.is_available}
                    onClick={() => {
                      if (provider.is_available) {
                        onProviderChange(provider.id)
                        setDropdownOpen(false)
                      }
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                    style={{
                      color: !provider.is_available
                        ? 'var(--text-tertiary)'
                        : isActive
                          ? 'var(--accent)'
                          : 'var(--text-primary)',
                      opacity: provider.is_available ? 1 : 0.4,
                      background: 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (provider.is_available) e.currentTarget.style.background = 'var(--surface-elevated)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {provider.type === 'cloud' ? <Cloud size={12} /> : <Monitor size={12} />}
                    <div>
                      <div className="font-medium">{provider.name}</div>
                      {provider.cost && (
                        <div className="text-[10px] opacity-60">{provider.cost}</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
