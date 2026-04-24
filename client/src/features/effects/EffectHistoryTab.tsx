import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import {
  selectEffectHistoryItems,
  selectEffectHistoryTotal,
  selectEffectHistoryStatus,
} from '@/store/selectors/historySelectors'
import { selectViewingRunRecord } from '@/store/selectors/runSelectors'
import { loadEffectHistory, openRunFromHistory, deleteRunFromHistory } from '@/store/actions/historyActions'
import { RunHistoryItem } from '@/components/RunHistoryItem'

interface EffectHistoryTabProps {
  effectId: string
}

export function EffectHistoryTab({ effectId }: EffectHistoryTabProps) {
  const items = useStore(selectEffectHistoryItems)
  const total = useStore(selectEffectHistoryTotal)
  const status = useStore(selectEffectHistoryStatus)
  const viewingRunRecord = useStore(selectViewingRunRecord)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadEffectHistory(effectId)
  }, [effectId])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver((entries) => {
      const s = useStore.getState()
      if (entries[0]?.isIntersecting && s.history.effectId === effectId
          && s.history.effectItems.size < s.history.effectTotal
          && s.history.effectStatus !== 'loading') {
        loadEffectHistory(effectId, s.history.effectItems.size)
      }
    }, { threshold: 0.1 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [effectId])

  if (status === 'loading' && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-xs text-muted-foreground">
        No runs yet
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <RunHistoryItem
          key={item.id}
          item={item}
          isActive={viewingRunRecord?.id === item.id}
          onClick={() => openRunFromHistory(item.id, effectId)}
          onDelete={() => deleteRunFromHistory(item.id, effectId)}
        />
      ))}

      {items.length < total && (
        <div ref={sentinelRef} className="flex justify-center py-3">
          {status === 'loading' && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
        </div>
      )}
    </div>
  )
}
