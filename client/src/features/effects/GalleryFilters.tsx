import { Search } from 'lucide-react'
import { useEffectsStore } from '@/store/effectsStore'
import { formatEffectType } from '@/lib/formatters'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

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
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="text"
          placeholder="Search effects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-foreground/[0.03] pl-9 pr-4"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.id
          return (
            <Button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
            >
              {cat.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
