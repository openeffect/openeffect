import { useState } from 'react'
import { Link, Trash2, Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { selectEffects } from '@/store/selectors/effectsSelectors'
import { loadEffects } from '@/store/actions/effectsActions'
import { api } from '@/utils/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Label } from '@/components/ui/Label'
import { Separator } from '@/components/ui/Separator'
import { FileDropzone } from '@/components/FileDropzone'

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
          <DialogTitle>Effects</DialogTitle>
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
                      onUninstalled={loadEffects}
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

function InstallEffectSection({ onInstalled }: { onInstalled: () => void }) {
  const [url, setUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleInstallUrl = async () => {
    if (!url.trim()) return
    setInstalling(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await api.installEffectFromUrl(url.trim())
      setSuccess(`Installed ${result.installed.length} effect(s)`)
      setUrl('')
      onInstalled()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Install failed')
    } finally {
      setInstalling(false)
    }
  }

  const handleInstallFile = async (file: File) => {
    setInstalling(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await api.installEffectFromFile(file)
      setSuccess(`Installed ${result.installed.length} effect(s)`)
      onInstalled()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Install failed')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="space-y-3">
      <Label variant="section">Install Effect</Label>

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
    </div>
  )
}

/* ─── Installed Effect Row ─── */

function InstalledEffectRow({
  effect,
  onUninstalled,
}: {
  effect: { namespace: string; id: string; name: string; source: string }
  onUninstalled: () => void
}) {
  const [uninstalling, setUninstalling] = useState(false)

  const handleUninstall = async () => {
    setUninstalling(true)
    try {
      await api.uninstallEffect(effect.namespace, effect.id)
      onUninstalled()
    } catch {
      setUninstalling(false)
    }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div>
        <span className="text-sm font-medium text-foreground">{effect.name}</span>
        <p className="text-xs text-muted-foreground">{effect.namespace}/{effect.id}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
        onClick={handleUninstall}
        disabled={uninstalling}
        title="Uninstall"
      >
        {uninstalling ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      </Button>
    </div>
  )
}
