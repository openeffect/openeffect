import { useEffect } from 'react'
import { updateJobProgress, completeJob, failJob } from '@/store/actions/runActions'

export function useSse(jobId: string | null) {
  useEffect(() => {
    if (!jobId) return

    const currentJobId = jobId

    let es: EventSource | null = null
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const MAX_RETRIES = 3

    function connect() {
      es = new EventSource(`/api/run/${currentJobId}/stream`)

      es.addEventListener('progress', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { progress: number; message: string }
          updateJobProgress(currentJobId, data.progress, data.message)
          retries = 0
        } catch {
          // Malformed event data — skip
        }
      })

      es.addEventListener('completed', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { video_url: string }
          completeJob(currentJobId, data.video_url)
        } catch {
          failJob(currentJobId, 'Received invalid completion data')
        }
        es?.close()
      })

      es.addEventListener('failed', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { error: string }
          failJob(currentJobId, data.error)
        } catch {
          failJob(currentJobId, 'Run failed (unknown error)')
        }
        es?.close()
      })

      es.onerror = () => {
        es?.close()
        if (retries < MAX_RETRIES) {
          retries++
          retryTimer = setTimeout(connect, 1000 * retries)
        } else {
          failJob(currentJobId, 'Connection lost. Check the History panel.')
        }
      }
    }

    connect()
    return () => {
      es?.close()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [jobId])
}
