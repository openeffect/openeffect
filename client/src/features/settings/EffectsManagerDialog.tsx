import { useState } from 'react'
import { Link, Trash2, Loader2, AlertTriangle, Check, X } from 'lucide-react'
import { useStore } from '@/store'
import { selectEffects } from '@/store/selectors/effectsSelectors'
import { deleteEffect, loadEffects, setEffectEditable } from '@/store/actions/effectsActions'
import { api, InstallConflictError, type InstallConflictEntry } from '@/utils/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Label } from '@/components/ui/Label'
import { Separator } from '@/components/ui/Separator'
import { Checkbox } from '@/components/ui/Checkbox'
import { FileDropzone } from '@/components/FileDropzone'
import type { EffectManifest } from '@/types/api'

interface EffectsManagerDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function EffectsManagerDialog({ isOpen, onClose }: EffectsManagerDialogProps) {
  const effects = useStore(selectEffects)

  const installedEffects = effects.filter((e) => e.source !== 'official')

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Install effect</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Install Effect */}
          <InstallEffectSection onInstalled={loadEffects} />

          {/* Installed Effects */}
          {installedEffects.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label variant="section">Installed Effects</Label>
                <div className="space-y-2">
                  {installedEffects.map((effect) => (
                    <InstalledEffectRow
                      key={`${effect.namespace}/${effect.id}`}
                      effect={effect}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Install Effect Section ─── */

type PendingInstall =
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: File }

function InstallEffectSection({ onInstalled }: { onInstalled: () => void }) {
  const [url, setUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{
    pending: PendingInstall
    conflicts: InstallConflictEntry[]
  } | null>(null)

  const runInstall = async (pending: PendingInstall, overwrite: boolean) => {
    if (pending.kind === 'url') {
      return api.installEffectFromUrl(pending.url, overwrite)
    }
    return api.installEffectFromFile(pending.file, overwrite)
  }

  const handleInstall = async (pending: PendingInstall, overwrite = false) => {
    setInstalling(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await runInstall(pending, overwrite)
      setSuccess(`Installed ${result.installed.length} effect(s)`)
      if (pending.kind === 'url') setUrl('')
      setConflict(null)
      onInstalled()
    } catch (e) {
      if (e instanceof InstallConflictError) {
        setConflict({ pending, conflicts: e.conflicts })
      } else {
        setError(e instanceof Error ? e.message : 'Install failed')
      }
    } finally {
      setInstalling(false)
    }
  }

  const handleInstallUrl = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    handleInstall({ kind: 'url', url: trimmed })
  }

  const handleInstallFile = (file: File) => {
    handleInstall({ kind: 'file', file })
  }

  return (
    <div className="space-y-3">
      {/* URL install */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Paste manifest.yaml or index.yaml URL..."
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); setSuccess(null) }}
            onKeyDown={(e) => e.key === 'Enter' && handleInstallUrl()}
            className="pl-9"
          />
        </div>
        <Button onClick={handleInstallUrl} disabled={!url.trim() || installing} className="py-2">
          {installing ? <Loader2 size={14} className="animate-spin" /> : 'Install'}
        </Button>
      </div>

      {/* ZIP upload */}
      <FileDropzone
        accept=".zip"
        label="Drop or click to upload .zip archive"
        disabled={installing}
        onFile={handleInstallFile}
      />

      {/* Feedback */}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && <p className="text-xs text-success">{success}</p>}

      <InstallConflictDialog
        state={conflict}
        installing={installing}
        onCancel={() => setConflict(null)}
        onConfirm={() => conflict && handleInstall(conflict.pending, true)}
      />
    </div>
  )
}

function InstallConflictDialog({
  state,
  installing,
  onCancel,
  onConfirm,
}: {
  state: { pending: PendingInstall; conflicts: InstallConflictEntry[] } | null
  installing: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const multiple = (state?.conflicts.length ?? 0) > 1
  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && !installing && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning" />
            Already installed
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {multiple
              ? 'These effects are already installed. Overwrite them?'
              : 'This effect is already installed. Overwrite it?'}
          </p>
          <div className="space-y-1.5">
            {state?.conflicts.map((c) => (
              <div key={`${c.namespace}/${c.id}`} className="rounded-md border px-3 py-2 text-xs">
                <div className="font-medium text-foreground">{c.name}</div>
                <div className="text-muted-foreground">
                  {c.namespace}/{c.id} — v{c.existing_version} → v{c.incoming_version}
                  {' '}<span className="opacity-60">({c.existing_source})</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onCancel} disabled={installing}>
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={installing}>
              {installing ? <Loader2 size={14} className="animate-spin" /> : multiple ? 'Update all' : 'Update'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Installed Effect Row ─── */

function InstalledEffectRow({ effect }: { effect: EffectManifest }) {
  const [uninstalling, setUninstalling] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editable, setEditable] = useState(effect.source === 'local')

  const handleUninstall = async () => {
    setUninstalling(true)
    await deleteEffect(effect.namespace, effect.id)
    // Store drops the item from its Map; this row unmounts with the list
  }

  const handleToggleEditable = async (value: boolean) => {
    setEditable(value) // optimistic
    try {
      await setEffectEditable(effect, value)
    } catch {
      setEditable(!value) // revert on failure
    }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">{effect.name}</span>
        <p className="text-xs text-muted-foreground">{effect.namespace}/{effect.id}</p>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox
          label="Editable"
          checked={editable}
          onCheckedChange={(v) => handleToggleEditable(v === true)}
        />
        {confirmDelete ? (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:bg-destructive/15"
              onClick={handleUninstall}
              disabled={uninstalling}
              title="Confirm uninstall"
            >
              {uninstalling ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setConfirmDelete(false)}
              disabled={uninstalling}
              title="Cancel"
            >
              <X size={14} />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            title="Uninstall"
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  )
}
