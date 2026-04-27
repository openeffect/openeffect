import { useState } from 'react'
import { X, MoreVertical, Copy, Download, Pencil, Trash2, AlertTriangle, FlaskConical } from 'lucide-react'
import { useStore } from '@/store'
import { selectSelectedEffect, selectSelectedId, selectRightTab } from '@/store/selectors/effectsSelectors'
import { selectAvailableModels } from '@/store/selectors/configSelectors'
import { formatEffectCategory } from '@/utils/formatters'
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
import { openInPlayground } from '@/store/actions/playgroundActions'
import { effectToPlaygroundParams } from '@/utils/playgroundSeed'
import { setState } from '@/store'
import { mutateSetRightTab } from '@/store/mutations/effectsMutations'
import { api } from '@/utils/api'
import { EffectFormTab } from './EffectFormTab'
import { EffectHistoryTab } from './EffectHistoryTab'
import { Button } from '@/components/ui/Button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { cn } from '@/utils/cn'
import type { EffectManifest } from '@/types/api'

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

  // UUID for API calls like history filtering (runs store the effect's UUID
  // in `record.effect_id`).
  const effectId = manifest?.id ?? selectedId
  const displayName = manifest?.name ?? 'Deleted effect'

  if (!manifest && !isOrphaned) return null

  const showFormTab = !!manifest && !isOrphaned
  // History tab is always rendered; just disabled when there's no effectId
  // (i.e. brand-new unsaved effect in the editor).
  const isHistoryEnabled = !!effectId
  // The "active" tab is what the user sees on screen. When only one tab is
  // available we override the sticky `rightTab` preference so the visual
  // indicator matches reality:
  //   - no form (orphaned effect, history-only)        → history
  //   - no history (brand-new unsaved effect, form-only) → form
  //   - both available → follow the user's last pick
  const activeTab: 'form' | 'history' = !showFormTab
    ? 'history'
    : !isHistoryEnabled
      ? 'form'
      : rightTab
  const showFormView = activeTab === 'form'

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
                {formatEffectCategory(manifest.category)}
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
              activeTab === 'form'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setState((s) => { mutateSetRightTab(s, 'form') }, 'effects/setTab')}
          >
            Form
          </button>
        )}
        <button
          disabled={!isHistoryEnabled}
          className={cn(
            'flex-1 py-2.5 text-xs font-medium transition-colors',
            activeTab === 'history'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground',
            isHistoryEnabled ? 'hover:text-foreground' : 'cursor-not-allowed opacity-40',
          )}
          onClick={() => {
            if (!isHistoryEnabled) return
            setState((s) => { mutateSetRightTab(s, 'history') }, 'effects/setTab')
          }}
        >
          History
        </button>
      </div>

      {/* Tab content — form stays mounted across tab switches so its useState
          (form values, advanced params, etc.) is preserved. The key still
          forces a remount when the selected effect or saveVersion changes,
          so switching effects or saving still gives a fresh form. */}
      {showFormTab && (
        <div className={cn('flex flex-1 flex-col overflow-hidden', !showFormView && 'hidden')}>
          <EffectFormTab key={`${selectedId}-${saveVersion}`} />
        </div>
      )}
      {!showFormView && effectId && (
        <div className="flex-1 overflow-y-auto p-3">
          <EffectHistoryTab effectId={effectId} />
        </div>
      )}
    </div>
  )
}

/* ─── Three-dot menu for Duplicate / Edit / Export ─── */
function EffectMenu({ effect, isInstalled }: { effect: EffectManifest; isInstalled: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const availableModels = useStore(selectAvailableModels)
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
    window.open(api.exportEffect(effect.namespace, effect.slug), '_blank')
  }

  const handleTryInPlayground = () => {
    openInPlayground(effectToPlaygroundParams(effect, availableModels))
  }

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmDelete(false) }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreVertical size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleTryInPlayground}>
          <FlaskConical size={14} />
          Playground
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleFork}>
          <Copy size={14} />
          Duplicate
        </DropdownMenuItem>
        {isInstalled && (
          <DropdownMenuItem onClick={handleExport}>
            <Download size={14} />
            Export
          </DropdownMenuItem>
        )}
        {isInstalled && isLocal && (
          <DropdownMenuItem onClick={() => editEffect(effect)}>
            <Pencil size={14} />
            Edit
          </DropdownMenuItem>
        )}
        {canDelete && (
          confirmDelete ? (
            <DropdownMenuItem onClick={() => deleteEffect(effect.namespace, effect.slug)} className="text-destructive hover:bg-destructive/15">
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
