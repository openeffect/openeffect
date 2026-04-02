import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-xl border bg-card text-card-foreground', className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'
