import { useState } from 'react'
import { Eye, EyeOff, Cloud } from 'lucide-react'
import { useConfigStore } from '@/store/configStore'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const hasApiKey = useConfigStore((s) => s.hasApiKey)
  const theme = useConfigStore((s) => s.theme)
  const setTheme = useConfigStore((s) => s.setTheme)
  const updateConfig = useConfigStore((s) => s.updateConfig)
  const availableModels = useConfigStore((s) => s.availableModels)

  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    await updateConfig({ fal_api_key: apiKey.trim() })
    setApiKey('')
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
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
              <Button onClick={handleSaveKey} disabled={!apiKey.trim()} className="py-2">
                Save
              </Button>
            </div>
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
                        {model.providers.map((provider) => (
                          <div key={provider.id} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Cloud size={12} className="text-muted-foreground" />
                              <span className="text-xs text-secondary-foreground">
                                {provider.name}
                              </span>
                              {provider.cost && (
                                <span className="text-[10px] text-muted-foreground">
                                  {provider.cost}
                                </span>
                              )}
                            </div>
                            {!provider.is_available && (
                              <span className="text-xs text-muted-foreground">
                                Needs API key
                              </span>
                            )}
                          </div>
                        ))}
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
