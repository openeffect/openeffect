import { Loader2, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'

interface GenerateButtonProps {
  onClick: () => void
  disabled: boolean
  loading: boolean
  cost?: string
}

export function GenerateButton({ onClick, disabled, loading, cost }: GenerateButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white transition-all',
        'disabled:pointer-events-none disabled:opacity-50',
        disabled ? 'bg-muted' : 'bg-primary shadow-[0_2px_8px_rgba(74,144,226,0.3)]',
      )}
      whileHover={!disabled ? { scale: 1.01, boxShadow: '0 4px 16px rgba(74,144,226,0.4)' } : undefined}
      whileTap={!disabled ? { scale: 0.99 } : undefined}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
      {loading ? 'Generating...' : 'Generate Video'}
      {!loading && cost && (
        <span className="text-xs font-normal opacity-70">{cost}</span>
      )}
    </motion.button>
  )
}
