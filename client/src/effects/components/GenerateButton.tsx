import { Loader2, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'

interface GenerateButtonProps {
  onClick: () => void
  disabled: boolean
  loading: boolean
}

export function GenerateButton({ onClick, disabled, loading }: GenerateButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        background: disabled ? 'var(--text-tertiary)' : 'var(--accent)',
        boxShadow: disabled ? 'none' : '0 2px 8px rgba(74,144,226,0.3)',
      }}
      whileHover={!disabled ? { scale: 1.01, boxShadow: '0 4px 16px rgba(74,144,226,0.4)' } : undefined}
      whileTap={!disabled ? { scale: 0.99 } : undefined}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
      {loading ? 'Generating...' : 'Generate Video'}
    </motion.button>
  )
}
