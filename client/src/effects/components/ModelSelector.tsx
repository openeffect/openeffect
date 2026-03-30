interface ModelSelectorProps {
  models: string[]
  selectedModel: string
  onChange: (model: string) => void
}

const MODEL_LABELS: Record<string, string> = {
  'fal-ai/wan-2.2': 'Wan 2.2',
  'fal-ai/kling-v3': 'Kling v3',
  'local/wan-2.2': 'Local Wan 2.2',
}

export function ModelSelector({ models, selectedModel, onChange }: ModelSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
        Model
      </label>
      <div className="flex flex-wrap gap-1.5">
        {models.map((model) => {
          const isActive = selectedModel === model
          return (
            <button
              key={model}
              onClick={() => onChange(model)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
              style={{
                background: isActive ? 'var(--accent)' : 'var(--surface-elevated)',
                color: isActive ? 'white' : 'var(--text-secondary)',
                border: isActive ? '1px solid transparent' : '1px solid var(--border)',
                boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {MODEL_LABELS[model] ?? model}
            </button>
          )
        })}
      </div>
    </div>
  )
}
