import { useEffect, useRef, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import {
  selectPlaygroundHistoryItems,
  selectPlaygroundHistoryTotal,
  selectPlaygroundHistoryStatus,
} from '@/store/selectors/historySelectors'
import { selectViewingRunRecord } from '@/store/selectors/runSelectors'
import { loadPlaygroundHistory, deletePlaygroundRun } from '@/store/actions/historyActions'
import { restoreFromUrl } from '@/store/actions/runActions'
import { RunHistoryItem } from '@/components/RunHistoryItem'

export function PlaygroundHistoryTab() {
  const items = useStore(selectPlaygroundHistoryItems)
  const total = useStore(selectPlaygroundHistoryTotal)
  const status = useStore(selectPlaygroundHistoryStatus)
  const viewingRunRecord = useStore(selectViewingRunRecord)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadPlaygroundHistory()
  }, [])

  const handleIntersect = useCallback((entries: IntersectionObserverEntry[]) => {
    const s = useStore.getState()
    if (
      entries[0]?.isIntersecting &&
      s.history.playgroundItems.size < s.history.playgroundTotal &&
      s.history.playgroundStatus !== 'loading'
    ) {
      loadPlaygroundHistory(s.history.playgroundItems.size)
    }
  }, [])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(handleIntersect, { threshold: 0.1 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [handleIntersect])

  // Open a historical playground run on the left without remounting the form.
  // We push to history directly (bypassing navigate()) so popstate doesn't fire
  // and double-fetch the record. The form key in PlaygroundPanel ignores the
  // `run` query param, so the user's draft is preserved.
  const handleOpen = async (id: string) => {
    const params = new URLSearchParams(window.location.search)
    params.set('run', id)
    window.history.pushState(null, '', `/playground?${params.toString()}`)
    await restoreFromUrl(id)
  }

  const handleDelete = async (id: string) => {
    await deletePlaygroundRun(id)
  }

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
          onClick={() => handleOpen(item.id)}
          onDelete={() => handleDelete(item.id)}
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
