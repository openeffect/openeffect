import { useState } from 'react'
import { Check, AlertTriangle, Download, Trash2, X } from 'lucide-react'
import { useStore } from '@/store'
import { selectAvailableModels } from '@/store/selectors/configSelectors'
import { selectJobs } from '@/store/selectors/runSelectors'
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
  const jobs = useStore(selectJobs)
  const modelName = availableModels.find((m) => m.id === item.model_id)?.name ?? item.model_id
  const badges = parseRunBadges(item.inputs)
  // Server-resolved input file refs — keyed by role (start_frame, etc.).
  const inputFiles = Object.entries(item.input_files ?? {})

  // Prefer the live SSE-backed job state over the record's DB snapshot so
  // the history row shows the same numbers as the run view (otherwise the
  // record's progress is whatever the server last persisted, which can lag
  // several seconds behind reality).
  const liveJob = jobs.get(item.id)
  const status = liveJob?.status ?? item.status
  const progress = liveJob?.progress ?? item.progress

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
            status === 'completed' && 'bg-success',
            status === 'failed' && 'bg-destructive',
            status === 'processing' && 'bg-primary',
          )}
        />
        {/* Video thumbnail — the file store guarantees a 512.webp
            poster frame on every video result. */}
        {status === 'completed' && item.output && (
          <div className="shrink-0 w-20 self-stretch overflow-hidden rounded-md border bg-muted">
            <img
              src={item.output.thumbnails['512']}
              alt=""
              className="h-full w-full object-cover"
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
              {inputFiles.map(([key, ref]) => (
                <div key={key} className="h-10 w-10 overflow-hidden rounded border bg-muted">
                  <img
                    src={ref.thumbnails['512']}
                    alt={key}
                    className="h-full w-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                </div>
              ))}
            </div>
            {status !== 'processing' && (
              <div className="flex items-center gap-1">
                {status === 'completed' && item.output && (
                  <a
                    href={item.output.url}
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
                    className="rounded-md p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Processing progress */}
          {status === 'processing' && (
            <div className="mt-1.5">
              <Progress progress={progress} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseRunBadges(inputs: unknown): [string, string][] {
  if (!inputs || typeof inputs !== 'object') return []
  const raw = inputs as Record<string, unknown>
  const allEntries = {
    ...(('inputs' in raw && typeof raw.inputs === 'object') ? raw.inputs as Record<string, unknown> : raw),
    ...(('output' in raw && typeof raw.output === 'object') ? raw.output as Record<string, unknown> : {}),
    ...(('user_params' in raw && typeof raw.user_params === 'object') ? raw.user_params as Record<string, unknown> : {}),
  }
  const badges: [string, string][] = []
  for (const [key, value] of Object.entries(allEntries)) {
    if (value == null || value === '') continue
    const strVal = String(value)
    // Skip image-input UUIDs — those are now rendered as thumbs from
    // `record.input_files`. Anything that isn't a UUID and is short
    // enough to fit on a badge (e.g. prompt, seed, intensity) shows up.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(strVal)) continue
    if (strVal.length <= 30) badges.push([key, strVal])
  }
  return badges
}

function formatParamKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
