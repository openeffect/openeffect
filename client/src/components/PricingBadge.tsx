import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'

/**
 * Provider-level pricing affordance: a small "Pricing" pill next to the
 * selected model/provider that opens a breakdown on hover. Same visual
 * language as `DollarBadge` (borderless, no pointer cursor) but uses a
 * text label since it lives next to the provider name where text reads
 * clearer than a standalone `$` glyph.
 */
export function PricingBadge({ tooltip }: { tooltip: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ml-1 inline-flex cursor-default items-center justify-center rounded-full bg-muted px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
          aria-label="Pricing info"
        >
          Pricing
        </span>
      </TooltipTrigger>
      {/* `whitespace-pre` + `font-mono` so the cost string renders as a rate
           card - multiple spaces survive, and every character has the same
           width so resolution / price / audio columns line up. */}
      <TooltipContent side="top" className="whitespace-pre font-mono">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
