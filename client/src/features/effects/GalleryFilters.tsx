import { useRef } from 'react'
import { Search, X, ChevronDown, Check } from 'lucide-react'
import { useEffectsStore } from '@/store/effectsStore'
import { formatEffectType } from '@/lib/formatters'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

const SOURCE_OPTIONS = [
  { id: 'official', label: 'Official' },
  { id: 'installed', label: 'Installed' },
] as const

export function GalleryFilters() {
  const effects = useEffectsStore((s) => s.effects)
  const searchQuery = useEffectsStore((s) => s.searchQuery)
  const setSearchQuery = useEffectsStore((s) => s.setSearchQuery)
  const activeSource = useEffectsStore((s) => s.activeSource)
  const setActiveSource = useEffectsStore((s) => s.setActiveSource)
  const activeCategory = useEffectsStore((s) => s.activeCategory)
  const setActiveCategory = useEffectsStore((s) => s.setActiveCategory)

  const hasInstalled = effects.some((e) => e.source !== 'official')

  const categories = Array.from(new Set(effects.map(e => e.type)))
    .map(t => ({ id: t, label: formatEffectType(t) }))

  const sourceLabel = SOURCE_OPTIONS.find((o) => o.id === activeSource)?.label
  const categoryLabel = categories.find((c) => c.id === activeCategory)?.label

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-4">
      {/* Source filter */}
      {hasInstalled && (
        <FilterDropdown
          placeholder="Source"
          value={sourceLabel}
          onClear={() => setActiveSource('all')}
        >
          {SOURCE_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.id}
              onClick={() => setActiveSource(opt.id)}
              className={cn(activeSource === opt.id && 'text-primary')}
            >
              {opt.label}
              {activeSource === opt.id && <Check size={12} className="ml-auto text-primary" />}
            </DropdownMenuItem>
          ))}
        </FilterDropdown>
      )}
      {/* Category filter */}
      {categories.length > 0 && (
        <FilterDropdown
          placeholder="Category"
          value={categoryLabel}
          onClear={() => setActiveCategory('all')}
        >
          {categories.map((cat) => (
            <DropdownMenuItem
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(activeCategory === cat.id && 'text-primary')}
            >
              {cat.label}
              {activeCategory === cat.id && <Check size={12} className="ml-auto text-primary" />}
            </DropdownMenuItem>
          ))}
        </FilterDropdown>
      )}
      {/* Search */}
      <div className="relative min-w-[140px] flex-1">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-foreground/[0.03] py-1.5 pl-8 pr-8 text-xs"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ─── Filter Dropdown ─── */

function FilterDropdown({
  placeholder,
  value,
  onClear,
  children,
}: {
  placeholder: string
  value: string | undefined
  onClear: () => void
  children: React.ReactNode
}) {
  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border bg-foreground/[0.03] transition-colors hover:border-foreground/15">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs outline-none">
            <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
              {value ?? placeholder}
            </span>
            <ChevronDown size={11} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {value && (
        <button
          onClick={onClear}
          className="border-l px-1.5 py-1.5 text-muted-foreground hover:text-foreground"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
