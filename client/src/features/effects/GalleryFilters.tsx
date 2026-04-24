import { Search, X, ChevronDown, Check } from 'lucide-react'
import { useStore } from '@/store'
import {
  selectEffects,
  selectSearchQuery,
  selectActiveSource,
  selectActiveCategory,
} from '@/store/selectors/effectsSelectors'
import {
  setSearchQuery,
  setActiveSource,
  setActiveCategory,
} from '@/store/actions/effectsActions'
import { formatEffectCategory } from '@/utils/formatters'
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
  const activeCategory = useStore(selectActiveCategory)

  const hasInstalled = effects.some((e) => e.source !== 'official' && e.source !== 'local')
  const hasMine = effects.some((e) => e.source === 'local')
  const showSourceFilter = hasInstalled || hasMine

  const categories = Array.from(new Set(effects.map(e => e.category)))
    .sort((a, b) => a.localeCompare(b))
    .map(c => ({ id: c, label: formatEffectCategory(c) }))

  const sourceLabel = SOURCE_OPTIONS.find((o) => o.id === activeSource)?.label
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
      {/* Category filter */}
      {categories.length > 0 && (
        <FilterDropdown
          placeholder="Category"
          value={categoryLabel}
          onClear={() => setActiveCategory('all')}
        >
          {categories.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={cn(activeCategory === c.id && 'text-primary')}
            >
              {c.label}
              {activeCategory === c.id && <Check size={12} className="ml-auto text-primary" />}
            </DropdownMenuItem>
          ))}
        </FilterDropdown>
      )}
      {/* Search */}
      <div className="relative min-w-[140px] flex-1">
        <Search
          size={13}
          className={cn(
            'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2',
            searchQuery ? 'text-primary' : 'text-muted-foreground',
          )}
        />
        <Input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={cn(
            'py-1.5 pl-8 pr-8 text-xs',
            searchQuery
              ? 'border-primary/40 bg-primary/10 hover:border-primary/60'
              : 'bg-muted',
          )}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-primary/70 hover:text-primary"
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
  const isActive = !!value
  return (
    <div
      className={cn(
        'inline-flex items-center overflow-hidden rounded-lg border transition-colors',
        isActive
          ? 'border-primary/40 bg-primary/10 hover:border-primary/60'
          : 'border-border bg-muted hover:border-foreground/15',
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs outline-none">
            <span className={isActive ? 'font-medium text-primary' : 'text-muted-foreground'}>
              {value ?? placeholder}
            </span>
            <ChevronDown size={11} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {isActive && (
        <button
          onClick={onClear}
          className="border-l border-primary/30 px-1.5 py-1.5 text-primary/70 hover:text-primary"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
