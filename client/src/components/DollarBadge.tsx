import { DollarSign } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'

/**
 * Unified `$` glyph used as a price affordance throughout the UI:
 *
 * - Next to a form field: signals that changing the field affects pricing
 *   (tooltip explains).
 * - Next to a model / provider: opens a breakdown of the per-second cost
 *   (tooltip carries the full cost string, rendered with preserved
 *   newlines so multi-tier strings show as a table).
 *
 * Borderless, no pointer cursor — it's an affordance, not a button.
 */
export function DollarBadge({ tooltip }: { tooltip: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ml-1 inline-flex h-3.5 w-3.5 cursor-default items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-label="Pricing info"
        >
          <DollarSign size={10} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="whitespace-pre-line">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
