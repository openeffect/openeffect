import { useState } from 'react'
import { Check, AlertTriangle, Download, Trash2, X } from 'lucide-react'
import { useStore } from '@/store'
import { selectAvailableModels } from '@/store/selectors/configSelectors'
import { formatRelativeTime } from '@/utils/formatters'
import { Progress } from '@/components/ui/Progress'
import { cn } from '@/utils/cn'
import type { RunRecord } from '@/types/api'

interface RunHistoryItemProps {
  item: RunRecord
  /** Show effect name in header (for global history) */
  effectName?: string
  /** Whether this item is orphaned (effect deleted) */
  isOrphaned?: boolean
  /** Whether this item is currently active/selected */
  isActive?: boolean
  onClick: () => void
  onDelete: () => void
}

export function RunHistoryItem({ item, effectName, isOrphaned, isActive, onClick, onDelete }: RunHistoryItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const availableModels = useStore(selectAvailableModels)
  const modelName = availableModels.find((m) => m.id === item.model_id)?.name ?? item.model_id
  const { badges, imageRefs } = parseRunParams(item.inputs)

  // Prepend model as first badge
  const allBadges: [string, string][] = []
  if (modelName) allBadges.push(['model', modelName])
  allBadges.push(...badges)

  return (
    <div
      className={cn(
        'cursor-pointer rounded-lg p-2.5 transition-colors hover:bg-muted',
        isActive && 'bg-primary/10 ring-1 ring-primary/20',
      )}
      onClick={onClick}
    >
      <div className="flex gap-2.5">
        {/* Status strip */}
        <div
          className={cn(
            'shrink-0 w-[2px] self-stretch rounded-full',
            item.status === 'completed' && 'bg-success',
            item.status === 'failed' && 'bg-destructive',
            item.status === 'processing' && 'bg-primary',
          )}
        />
        {/* Video thumbnail */}
        {item.status === 'completed' && item.video_url && (
          <div className="shrink-0 w-20 self-stretch overflow-hidden rounded-md border bg-muted">
            <video
              src={item.video_url}
              className="h-full w-full object-cover"
              muted
              preload="metadata"
              onLoadedData={(e) => { (e.target as HTMLVideoElement).currentTime = 0.5 }}
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header row — only shown when effectName is present (global history) */}
          {effectName && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {isOrphaned && <AlertTriangle size={12} className="shrink-0 text-warning" />}
                <span className="text-xs font-medium text-foreground">{effectName}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatRelativeTime(item.created_at)}
              </span>
            </div>
          )}

          {/* Badges row — when no effectName, status + time are inline with badges */}
          <div className={cn('flex flex-wrap items-center gap-1', effectName && 'mt-1')}>
            {allBadges.map(([key, value]) => (
              <span
                key={key}
                className="inline-flex items-center gap-0.5 rounded border bg-muted/50 px-1.5 py-0 text-[10px] leading-[18px]"
              >
                <span className="text-muted-foreground">{formatParamKey(key)}</span>
                <span className="font-medium text-secondary-foreground">{value}</span>
              </span>
            ))}
            {!effectName && (
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {formatRelativeTime(item.created_at)}
              </span>
            )}
          </div>

          {/* Images + actions */}
          <div className="mt-1.5 flex items-end justify-between">
            <div className="flex gap-1.5">
              {imageRefs.map(([key, refId]) => (
                <div key={key} className="h-10 w-10 overflow-hidden rounded border bg-muted">
                  <img
                    src={`/api/uploads/${refId}/512`}
                    alt={key}
                    className="h-full w-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                </div>
              ))}
            </div>
            {item.status !== 'processing' && (
              <div className="flex items-center gap-1">
                {item.status === 'completed' && item.video_url && (
                  <a
                    href={item.video_url}
                    download
                    onClick={(e) => e.stopPropagation()}
                    title="Download"
                    className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                  >
                    <Download size={12} />
                  </a>
                )}
                {confirmDelete ? (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(); setConfirmDelete(false) }}
                      className="rounded-md p-1 text-destructive hover:bg-destructive/15"
                      title="Confirm delete"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
                      className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                      title="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
                    className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Processing progress */}
          {item.status === 'processing' && (
            <div className="mt-1.5">
              <Progress progress={item.progress} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseRunParams(inputs: unknown): { badges: [string, string][]; imageRefs: [string, string][] } {
  if (!inputs || typeof inputs !== 'object') return { badges: [], imageRefs: [] }
  const raw = inputs as Record<string, unknown>
  const allEntries = {
    ...(('inputs' in raw && typeof raw.inputs === 'object') ? raw.inputs as Record<string, unknown> : raw),
    ...(('output' in raw && typeof raw.output === 'object') ? raw.output as Record<string, unknown> : {}),
    ...(('user_params' in raw && typeof raw.user_params === 'object') ? raw.user_params as Record<string, unknown> : {}),
  }
  const badges: [string, string][] = []
  const imageRefs: [string, string][] = []
  for (const [key, value] of Object.entries(allEntries)) {
    if (value == null || value === '') continue
    const strVal = String(value)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(strVal)) {
      imageRefs.push([key, strVal])
    } else if (strVal.length <= 30) {
      badges.push([key, strVal])
    }
  }
  return { badges, imageRefs }
}

function formatParamKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
