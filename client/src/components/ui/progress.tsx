import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ProgressProps {
  progress: number
  className?: string
}

export function Progress({ progress, className }: ProgressProps) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-primary to-accent-hover"
        animate={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        transition={{ ease: 'easeOut', duration: 0.4 }}
      />
    </div>
  )
}
