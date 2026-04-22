import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { forwardRef, useId, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@/utils/cn'

interface CheckboxProps extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label?: string
}

export const Checkbox = forwardRef<
  HTMLButtonElement,
  CheckboxProps
>(({ className, label, id, ...props }, ref) => {
  const generatedId = useId()
  const checkboxId = id || generatedId

  const checkbox = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={checkboxId}
      className={cn(
        'peer h-[18px] w-[18px] shrink-0 rounded-[4px] border-[1.5px] border-foreground/25 transition-all duration-150',
        'hover:border-foreground/40',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary/90',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check size={12} strokeWidth={2.5} className="text-white" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )

  if (!label) return checkbox

  return (
    <div className="flex items-center gap-2">
      {checkbox}
      <label htmlFor={checkboxId} className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
    </div>
  )
})
Checkbox.displayName = 'Checkbox'
