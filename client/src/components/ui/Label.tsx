import { forwardRef, type LabelHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

type LabelVariant = 'form' | 'section'

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  variant?: LabelVariant
}

const variantStyles: Record<LabelVariant, string> = {
  form: 'mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground',
  section: 'mb-2 block text-sm font-medium text-secondary-foreground',
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, variant = 'form', ...props }, ref) => (
    <label
      ref={ref}
      className={cn(variantStyles[variant], className)}
      {...props}
    />
  ),
)
Label.displayName = 'Label'
