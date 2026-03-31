import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'accent' | 'overlay' | 'outline'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-muted text-secondary-foreground',
  accent: 'bg-accent-dim text-accent',
  overlay: 'bg-black/50 text-white/90 backdrop-blur-sm',
  outline: 'border text-muted-foreground',
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  )
}
