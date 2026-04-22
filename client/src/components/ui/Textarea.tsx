import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(
        'w-full rounded-lg border bg-muted px-3 py-2 text-sm text-foreground outline-none placeholder:opacity-40 hover:border-foreground/15 focus-visible:border-ring resize-none',
        error && 'border-destructive hover:border-destructive focus-visible:border-destructive',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
