interface AspectRatioSelectorProps {
  ratios: string[]
  selected: string
  onChange: (ratio: string) => void
}

export function AspectRatioSelector({ ratios, selected, onChange }: AspectRatioSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
        Aspect Ratio
      </label>
      <div className="flex gap-1.5">
        {ratios.map((ratio) => {
          const isActive = selected === ratio
          return (
            <button
              key={ratio}
              onClick={() => onChange(ratio)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium tabular-nums transition-all"
              style={{
                background: isActive ? 'var(--accent)' : 'var(--surface-elevated)',
                color: isActive ? 'white' : 'var(--text-secondary)',
                border: isActive ? '1px solid transparent' : '1px solid var(--border)',
              }}
            >
              {ratio}
            </button>
          )
        })}
      </div>
    </div>
  )
}
