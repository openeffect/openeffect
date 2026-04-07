import { AlertTriangle } from 'lucide-react'
import { useStore } from '@/store'
import { selectViewingRunRecord, selectLastAppliedRunId } from '@/store/selectors/runSelectors'
import { applyRunParams } from '@/store/actions/runActions'
import { Button } from '@/components/ui/Button'

interface RestoreFormBannerProps {
  /**
   * Form kind. Used to filter out viewingRunRecord values that belong to the
   * other panel — e.g. the playground form's banner shouldn't react to an
   * effect run that's still lingering in viewingRunRecord after a navigation.
   */
  kind: 'effect' | 'playground'
}

/**
 * One-shot warning banner shown above the form when a historical run is
 * being viewed on the left and its parameters aren't loaded into the form
 * yet. Click "Apply" → params load, banner hides until the user switches
 * to a different run.
 */
export function RestoreFormBanner({ kind }: RestoreFormBannerProps) {
  const record = useStore(selectViewingRunRecord)
  const lastAppliedRunId = useStore(selectLastAppliedRunId)

  if (!record) return null
  if (record.kind !== kind) return null
  if (record.id === lastAppliedRunId) return null

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
      <AlertTriangle size={14} className="shrink-0 text-amber-500" />
      <span className="flex-1 text-xs text-foreground">
        This run's parameters aren't loaded in the form.
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => applyRunParams(record)}
        className="h-7 border-amber-500/40 text-xs hover:border-amber-500/60 hover:bg-amber-500/15"
      >
        Apply to form
      </Button>
    </div>
  )
}
