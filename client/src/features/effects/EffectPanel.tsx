import { useState } from 'react'
import { X, MoreVertical, GitFork, Download, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { useStore } from '@/store'
import { selectSelectedEffect, selectSelectedId, selectRightTab } from '@/store/selectors/effectsSelectors'
import { formatEffectType } from '@/utils/formatters'
import { Badge } from '@/components/ui/Badge'
import {
  selectEditorIsOpen,
  selectSavedManifest,
  selectEditingEffectId,
  selectSaveVersion,
} from '@/store/selectors/editorSelectors'
import { selectEffect } from '@/store/actions/effectsActions'
import {
  confirmClose,
  closeEditor,
  forkEffect,
  forkFromManifest,
  editEffect,
} from '@/store/actions/editorActions'
import { deleteEffect } from '@/store/actions/effectsActions'
import { setState } from '@/store'
import { mutateSetRightTab } from '@/store/mutations/effectsMutations'
import { api } from '@/utils/api'
import { EffectFormTab } from './EffectFormTab'
import { EffectHistoryTab } from './EffectHistoryTab'
import { Button } from '@/components/ui/Button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { cn } from '@/utils/cn'

export function EffectPanel() {
  const selectedEffect = useStore(selectSelectedEffect)
  const selectedId = useStore(selectSelectedId)
  const editorSavedManifest = useStore(selectSavedManifest)
  const isEditorOpen = useStore(selectEditorIsOpen)
  const editingEffectId = useStore(selectEditingEffectId)
  const saveVersion = useStore(selectSaveVersion)
  const rightTab = useStore(selectRightTab)

  const manifest = isEditorOpen
    ? (editorSavedManifest ?? selectedEffect)
    : selectedEffect

  // Orphaned effect: selected but not found in loaded effects
  const isOrphaned = !!selectedId && !selectedEffect && !isEditorOpen

  // DB UUID for API calls like history filtering (runs store db_id as effect_id)
  const effectDbId = manifest?.db_id ?? selectedId
  const displayName = manifest?.name ?? 'Deleted effect'

  if (!manifest && !isOrphaned) return null

  const showFormTab = !!manifest && !isOrphaned
  const showHistoryTab = !!effectDbId

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between border-b px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isOrphaned && <AlertTriangle size={14} className="shrink-0 text-warning" />}
            <h2 className="truncate text-sm font-bold text-foreground">
              {displayName}
            </h2>
            {manifest && (
              <Badge variant="accent" className="shrink-0 font-semibold uppercase tracking-wider">
                {formatEffectType(manifest.type)}
              </Badge>
            )}
          </div>
          {manifest && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {manifest.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 ml-2">
          {manifest && !(isEditorOpen && !editingEffectId) && (
            <EffectMenu effect={manifest} isInstalled={!!selectedEffect} />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (isEditorOpen) {
                if (!confirmClose()) return
                closeEditor()
              }
              selectEffect(null)
            }}
          >
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 border-b">
        {showFormTab && (
          <button
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              rightTab === 'form' || !showHistoryTab
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setState((s) => { mutateSetRightTab(s, 'form') }, 'effects/setTab')}
          >
            Form
          </button>
        )}
        {showHistoryTab && (
          <button
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              rightTab === 'history' || !showFormTab
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setState((s) => { mutateSetRightTab(s, 'history') }, 'effects/setTab')}
          >
            History
          </button>
        )}
      </div>

      {/* Tab content */}
      {(rightTab === 'form' && showFormTab) || !showHistoryTab ? (
        <EffectFormTab key={`${selectedId}-${saveVersion}`} />
      ) : effectDbId ? (
        <div className="flex-1 overflow-y-auto p-3">
          <EffectHistoryTab effectId={effectDbId} />
        </div>
      ) : null}
    </div>
  )
}

/* ─── Three-dot menu for Fork / Edit / Export ─── */
function EffectMenu({ effect, isInstalled }: { effect: import('@/types/api').EffectManifest; isInstalled: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isLocal = effect.source === 'local'
  const canDelete = isInstalled && effect.source !== 'official'

  const handleFork = () => {
    if (isInstalled) {
      forkEffect(effect)
    } else {
      forkFromManifest(effect)
    }
  }

  const handleExport = () => {
    window.open(api.exportEffect(effect.namespace, effect.id), '_blank')
  }

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmDelete(false) }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreVertical size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleFork}>
          <GitFork size={14} />
          Fork
        </DropdownMenuItem>
        {isInstalled && isLocal && (
          <DropdownMenuItem onClick={() => editEffect(effect)}>
            <Pencil size={14} />
            Edit
          </DropdownMenuItem>
        )}
        {isInstalled && (
          <DropdownMenuItem onClick={handleExport}>
            <Download size={14} />
            Export
          </DropdownMenuItem>
        )}
        {canDelete && (
          confirmDelete ? (
            <DropdownMenuItem onClick={() => deleteEffect(effect.namespace, effect.id)} className="text-destructive hover:bg-destructive/15">
              <Trash2 size={14} />
              Confirm delete
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={(e) => { e.preventDefault(); setConfirmDelete(true) }} className="text-destructive">
              <Trash2 size={14} />
              Delete
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
