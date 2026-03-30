import { motion } from 'framer-motion'

interface ProgressBarProps {
  progress: number
  className?: string
}

export function ProgressBar({ progress, className = '' }: ProgressBarProps) {
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full ${className}`}
      style={{ background: 'var(--surface-elevated)' }}
    >
      <motion.div
        className="h-full rounded-full"
        style={{
          background: 'linear-gradient(90deg, var(--accent), var(--accent-hover))',
        }}
        animate={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        transition={{ ease: 'easeOut', duration: 0.4 }}
      />
    </div>
  )
}
