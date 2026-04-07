import { X, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useStore, setState } from '@/store'
import { selectRightTab } from '@/store/selectors/effectsSelectors'
import { mutateSetRightTab } from '@/store/mutations/effectsMutations'
import { closePlayground } from '@/store/actions/playgroundActions'
import { PlaygroundForm } from './PlaygroundForm'
import { PlaygroundHistoryTab } from './PlaygroundHistoryTab'
import { cn } from '@/utils/cn'

export function PlaygroundPanel() {
  const rightTab = useStore(selectRightTab)

  return (
    <div className="flex h-full flex-col">
      {/* Header — mirrors EffectPanel layout */}
      <div className="flex shrink-0 items-start justify-between border-b px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FlaskConical size={14} className="shrink-0 text-primary" />
            <h2 className="truncate text-sm font-bold text-foreground">Playground</h2>
            <Badge variant="accent" className="shrink-0 font-semibold uppercase tracking-wider">
              Direct
            </Badge>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Run a model directly with your own prompt and params.
          </p>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => closePlayground()}
          >
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 border-b">
        <button
          className={cn(
            'flex-1 py-2.5 text-xs font-medium transition-colors',
            rightTab === 'form'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setState((s) => { mutateSetRightTab(s, 'form') }, 'playground/setTab')}
        >
          Form
        </button>
        <button
          className={cn(
            'flex-1 py-2.5 text-xs font-medium transition-colors',
            rightTab === 'history'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setState((s) => { mutateSetRightTab(s, 'history') }, 'playground/setTab')}
        >
          History
        </button>
      </div>

      {/* Tab content — form stays mounted across tab switches so its useState
          (prompt, image inputs, etc.) is preserved. History remounts on each
          open which is fine — its state lives in the global store. */}
      <div className={cn('flex flex-1 flex-col overflow-hidden', rightTab !== 'form' && 'hidden')}>
        <PlaygroundForm />
      </div>
      {rightTab === 'history' && (
        <div className="flex-1 overflow-y-auto p-3">
          <PlaygroundHistoryTab />
        </div>
      )}
    </div>
  )
}
