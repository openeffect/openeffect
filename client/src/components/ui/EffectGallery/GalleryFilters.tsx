import { Search } from 'lucide-react'
import { useEffectsStore } from '@/store/effectsStore'
import { formatEffectType } from '@/lib/formatters'

export function GalleryFilters() {
  const effects = useEffectsStore((s) => s.effects)
  const searchQuery = useEffectsStore((s) => s.searchQuery)
  const setSearchQuery = useEffectsStore((s) => s.setSearchQuery)
  const activeCategory = useEffectsStore((s) => s.activeCategory)
  const setActiveCategory = useEffectsStore((s) => s.setActiveCategory)

  const categories = [
    { id: 'all', label: 'All' },
    ...Array.from(new Set(effects.map(e => e.type)))
      .map(t => ({ id: t, label: formatEffectType(t) }))
  ]

  return (
    <div className="space-y-3 px-6 pb-3 pt-3">
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-tertiary)' }}
        />
        <input
          type="text"
          placeholder="Search effects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg py-2 pl-9 pr-4 text-sm outline-none placeholder:opacity-50"
          style={{
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.id
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className="rounded-full px-3 py-1 text-xs font-medium transition-all"
              style={{
                background: isActive ? 'var(--accent)' : 'var(--surface)',
                color: isActive ? 'white' : 'var(--text-secondary)',
                border: isActive ? '1px solid transparent' : '1px solid var(--border)',
              }}
            >
              {cat.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
