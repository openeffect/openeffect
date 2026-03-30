import { useEffect } from 'react'
import { useGenerationStore } from '@/store/generationStore'

export function useSse(jobId: string | null) {
  const updateJobProgress = useGenerationStore((s) => s.updateJobProgress)
  const completeJob = useGenerationStore((s) => s.completeJob)
  const failJob = useGenerationStore((s) => s.failJob)

  useEffect(() => {
    if (!jobId) return

    const currentJobId = jobId

    let es: EventSource | null = null
    let retries = 0
    const MAX_RETRIES = 3

    function connect() {
      es = new EventSource(`/api/generate/${currentJobId}/stream`)

      es.addEventListener('progress', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { progress: number; message: string }
        updateJobProgress(currentJobId, data.progress, data.message)
        retries = 0
      })

      es.addEventListener('completed', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { video_url: string }
        completeJob(currentJobId, data.video_url)
        es?.close()
      })

      es.addEventListener('failed', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { error: string }
        failJob(currentJobId, data.error)
        es?.close()
      })

      es.onerror = () => {
        es?.close()
        if (retries < MAX_RETRIES) {
          retries++
          setTimeout(connect, 1000 * retries)
        } else {
          failJob(currentJobId, 'Connection lost. Check the History panel.')
        }
      }
    }

    connect()
    return () => {
      es?.close()
    }
  }, [jobId, updateJobProgress, completeJob, failJob])
}
