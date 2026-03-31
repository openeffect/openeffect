import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-lg border bg-muted px-3 py-2 text-sm text-foreground outline-none placeholder:opacity-40 hover:border-foreground/15 focus-visible:border-ring resize-none',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
