import { forwardRef, useRef, type InputHTMLAttributes } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    if (type === 'number') {
      return <NumberInput ref={ref} className={className} {...props} />
    }

    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'w-full rounded-lg border bg-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground hover:border-foreground/15 focus-visible:border-ring',
          className,
        )}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

const NumberInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, step, min, max, onChange, ...props }, ref) => {
    const localRef = useRef<HTMLInputElement>(null)
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || localRef
    const stepVal = Number(step) || 1

    const adjust = (delta: number) => {
      const input = inputRef.current
      if (!input) return
      let next = Number(input.value) + delta * stepVal
      if (min != null) next = Math.max(Number(min), next)
      if (max != null) next = Math.min(Number(max), next)
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, String(next))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }

    return (
      <div className={cn('flex items-center rounded-lg border bg-muted transition-colors hover:border-foreground/15 [&:has(:focus-visible)]:border-ring', className)}>
        <button
          type="button"
          onClick={() => { adjust(-1); inputRef.current?.focus() }}
          className="flex shrink-0 items-center px-2.5 py-2 text-muted-foreground transition-colors hover:text-foreground"
          tabIndex={-1}
        >
          <Minus size={12} />
        </button>
        <input
          ref={inputRef}
          type="number"
          step={step}
          min={min}
          max={max}
          onChange={onChange}
          className="w-full min-w-0 bg-transparent py-2 text-center text-sm text-foreground outline-none tabular-nums focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
          {...props}
        />
        <button
          type="button"
          onClick={() => { adjust(1); inputRef.current?.focus() }}
          className="flex shrink-0 items-center px-2.5 py-2 text-muted-foreground transition-colors hover:text-foreground"
          tabIndex={-1}
        >
          <Plus size={12} />
        </button>
      </div>
    )
  },
)
NumberInput.displayName = 'NumberInput'
