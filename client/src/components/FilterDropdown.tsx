import { ChevronDown, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/utils/cn'

/** Placeholder-or-value pill with a muted/primary styling swap and a
 *  clear-X button that surfaces only when a value is active. Used by
 *  the gallery filter bar and the effects-manager dialog so both
 *  surfaces share one visual vocabulary. */
export function FilterDropdown({
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
