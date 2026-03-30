interface DurationSelectorProps {
  durations: number[]
  selected: number
  onChange: (duration: number) => void
}

export function DurationSelector({ durations, selected, onChange }: DurationSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
        Duration
      </label>
      <div className="flex gap-1.5">
        {durations.map((d) => {
          const isActive = selected === d
          return (
            <button
              key={d}
              onClick={() => onChange(d)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium tabular-nums transition-all"
              style={{
                background: isActive ? 'var(--accent)' : 'var(--surface-elevated)',
                color: isActive ? 'white' : 'var(--text-secondary)',
                border: isActive ? '1px solid transparent' : '1px solid var(--border)',
              }}
            >
              {d}s
            </button>
          )
        })}
      </div>
    </div>
  )
}
