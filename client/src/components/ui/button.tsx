import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline'
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantStyles: Record<ButtonVariant, string> = {
  default: 'border border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-accent-hover active:opacity-90',
  secondary: 'border border-transparent bg-muted text-secondary-foreground shadow-sm hover:bg-foreground/[0.08] hover:text-foreground active:opacity-90',
  ghost: 'border border-transparent text-secondary-foreground hover:bg-foreground/[0.06] hover:text-foreground active:opacity-90',
  destructive: 'border border-transparent bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/80 active:opacity-90',
  outline: 'border text-secondary-foreground hover:bg-foreground/[0.06] hover:text-foreground active:opacity-90',
}

const sizeStyles: Record<ButtonSize, string> = {
  default: 'rounded-lg px-4 py-2.5 text-sm font-semibold',
  sm: 'rounded-lg px-3 py-1.5 text-xs font-medium',
  lg: 'rounded-xl px-6 py-3 text-sm font-bold',
  icon: 'h-8 w-8 rounded-lg',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 transition-all disabled:pointer-events-none disabled:opacity-50',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
