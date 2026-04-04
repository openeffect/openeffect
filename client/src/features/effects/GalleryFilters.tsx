import { Search, X, ChevronDown, Check } from 'lucide-react'
import { useStore } from '@/store'
import {
  selectEffects,
  selectSearchQuery,
  selectActiveSource,
  selectActiveType,
  selectActiveCategory,
  selectAvailableCategories,
} from '@/store/selectors/effectsSelectors'
import {
  setSearchQuery,
  setActiveSource,
  setActiveType,
  setActiveCategory,
} from '@/store/actions/effectsActions'
import { formatEffectType } from '@/utils/formatters'
import { Input } from '@/components/ui/Input'
import { cn } from '@/utils/cn'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import type { EffectSource } from '@/store/types'

const SOURCE_OPTIONS = [
  { id: 'official', label: 'Official' },
  { id: 'mine', label: 'Mine' },
  { id: 'installed', label: 'Installed' },
] as const

export function GalleryFilters() {
  const effects = useStore(selectEffects)
  const searchQuery = useStore(selectSearchQuery)
  const activeSource = useStore(selectActiveSource)
  const activeType = useStore(selectActiveType)
  const activeCategory = useStore(selectActiveCategory)
  const availableCategories = useStore(selectAvailableCategories)

  const hasInstalled = effects.some((e) => e.source !== 'official' && e.source !== 'local')
  const hasMine = effects.some((e) => e.source === 'local')
  const showSourceFilter = hasInstalled || hasMine

  const types = Array.from(new Set(effects.map(e => e.type)))
    .map(t => ({ id: t, label: formatEffectType(t) }))

  const categories = availableCategories
    .map(c => ({ id: c, label: formatEffectType(c) }))

  const sourceLabel = SOURCE_OPTIONS.find((o) => o.id === activeSource)?.label
  const typeLabel = types.find((t) => t.id === activeType)?.label
  const categoryLabel = categories.find((c) => c.id === activeCategory)?.label

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-4">
      {/* Source filter */}
      {showSourceFilter && (
        <FilterDropdown
          placeholder="Source"
          value={sourceLabel}
          onClear={() => setActiveSource('all')}
        >
          {SOURCE_OPTIONS
            .filter((opt) => {
              if (opt.id === 'installed' && !hasInstalled) return false
              if (opt.id === 'mine' && !hasMine) return false
              return true
            })
            .map((opt) => (
            <DropdownMenuItem
              key={opt.id}
              onClick={() => setActiveSource(opt.id as EffectSource)}
              className={cn(activeSource === opt.id && 'text-primary')}
            >
              {opt.label}
              {activeSource === opt.id && <Check size={12} className="ml-auto text-primary" />}
            </DropdownMenuItem>
          ))}
        </FilterDropdown>
      )}
      {/* Type filter */}
      {types.length > 0 && (
        <FilterDropdown
          placeholder="Type"
          value={typeLabel}
          onClear={() => setActiveType('all')}
        >
          {types.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => setActiveType(t.id)}
              className={cn(activeType === t.id && 'text-primary')}
            >
              {t.label}
              {activeType === t.id && <Check size={12} className="ml-auto text-primary" />}
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
          className="bg-muted py-1.5 pl-8 pr-8 text-xs"
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
    <div className="inline-flex items-center overflow-hidden rounded-lg border bg-muted transition-colors hover:border-foreground/15">
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
