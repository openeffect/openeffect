import { useState } from 'react'
import { Eye, EyeOff, Cloud } from 'lucide-react'
import { useStore } from '@/store'
import { selectHasApiKey, selectApiKeyFromEnv, selectTheme, selectAvailableModels } from '@/store/selectors/configSelectors'
import { setTheme, updateConfig } from '@/store/actions/configActions'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Label } from '@/components/ui/Label'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Separator } from '@/components/ui/Separator'
import { PricingBadge } from '@/components/PricingBadge'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const hasApiKey = useStore(selectHasApiKey)
  const apiKeyFromEnv = useStore(selectApiKeyFromEnv)
  const theme = useStore(selectTheme)
  const availableModels = useStore(selectAvailableModels)

  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    try {
      await updateConfig({ fal_api_key: apiKey.trim() })
      setApiKey('')
    } catch {
      // API failed - key field stays populated so user can retry
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* API Key */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Label variant="section" className="mb-0">fal.ai API Key</Label>
              {hasApiKey && !apiKey && (
                <Badge className="bg-success/10 text-success">Active</Badge>
              )}
            </div>
            {apiKeyFromEnv ? (
              // Env-provided keys always win in `ConfigService.get_api_key`,
              // so hiding the input prevents users from "saving" a key that
              // would be shadowed on the next read.
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Key is set via the <code className="rounded bg-foreground/10 px-1 font-mono">FAL_KEY</code>{' '}
                environment variable. To change it, update the env var and restart the app.
              </p>
            ) : (
              <ApiKeyRow
                apiKey={apiKey}
                setApiKey={setApiKey}
                showKey={showKey}
                setShowKey={setShowKey}
                hasApiKey={hasApiKey}
                onSave={handleSaveKey}
              />
            )}
          </div>

          {/* Models */}
          {availableModels.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label variant="section">Models</Label>
                <div className="space-y-3">
                  {availableModels.map((model) => (
                    <Card key={model.id} className="p-3">
                      <div className="mb-2">
                        <span className="text-sm font-medium text-foreground">
                          {model.name}
                        </span>
                        {model.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {model.description}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {model.providers.map((provider) => {
                          const providerCost = provider.variants?.image_to_video?.cost
                          return (
                            <div key={provider.id} className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <Cloud size={12} className="shrink-0 text-muted-foreground" />
                                <span className="truncate text-xs text-secondary-foreground">
                                  {provider.name}
                                </span>
                                {providerCost && <PricingBadge tooltip={providerCost} />}
                              </div>
                              {!provider.is_available && (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  Needs API key
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Theme */}
          <div className="space-y-2">
            <Label variant="section">Theme</Label>
            <div className="flex gap-2">
              {(['auto', 'dark', 'light'] as const).map((t) => (
                <Button
                  key={t}
                  variant={theme === t ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTheme(t)}
                  className="capitalize"
                >
                  {t === 'auto' ? 'System' : t}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ApiKeyRow({
  apiKey,
  setApiKey,
  showKey,
  setShowKey,
  hasApiKey,
  onSave,
}: {
  apiKey: string
  setApiKey: (v: string) => void
  showKey: boolean
  setShowKey: (v: boolean) => void
  hasApiKey: boolean
  onSave: () => void
}) {
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? 'Enter new key to update...' : 'Paste your fal.ai key...'}
          className="pr-10"
        />
        <button
          onClick={() => setShowKey(!showKey)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
        >
          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <Button onClick={onSave} disabled={!apiKey.trim()} className="py-2">
        Save
      </Button>
    </div>
  )
}
