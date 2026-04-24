import { api } from '@/utils/api'
import { setState } from './index'
import { completeJob, failJob, updateJobProgress } from './actions/runActions'
import type { RunRecord } from '@/types/api'

/**
 * Single multiplexed SSE connection for all in-flight runs.
 *
 * Lifecycle is driven by the tracked-jobs set: `trackJob()` opens the
 * EventSource on the first job and `untrackJob()` closes it the moment
 * the set empties. Terminal events (`completed`/`failed`) auto-untrack.
 * The connection reconnects automatically via EventSource's native retry;
 * if bouncing fails repeatedly we give up and mark tracked jobs as failed
 * so the UI doesn't spin forever.
 */

const STREAM_URL = '/api/runs/stream'
const MAX_RETRIES = 3

let es: EventSource | null = null
let tracked: Set<string> = new Set()
let retries = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

function ensureOpen(): void {
  if (es || tracked.size === 0) return
  // No EventSource in the environment (SSR / tests / older runtimes).
  // Tracking still works — the set grows — but no wire connection opens.
  if (typeof EventSource === 'undefined') return

  es = new EventSource(STREAM_URL)

  es.addEventListener('progress', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as { job_id: string; progress: number; message: string }
      retries = 0
      if (!tracked.has(data.job_id)) return
      updateJobProgress(data.job_id, data.progress, data.message)
    } catch {
      // Malformed payload — skip.
    }
  })

  es.addEventListener('completed', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as { job_id: string; video_url: string }
      if (tracked.has(data.job_id)) completeJob(data.job_id, data.video_url)
      untrackJob(data.job_id)
    } catch {
      // Malformed payload — skip.
    }
  })

  es.addEventListener('failed', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as { job_id: string; error: string }
      if (tracked.has(data.job_id)) failJob(data.job_id, data.error)
      untrackJob(data.job_id)
    } catch {
      // Malformed payload — skip.
    }
  })

  // `keepalive` has no payload; just acknowledges the connection is live.
  es.addEventListener('keepalive', () => { retries = 0 })

  es.onerror = () => {
    es?.close()
    es = null
    if (tracked.size === 0) return
    if (retries >= MAX_RETRIES) {
      // Bail: mark every tracked job failed, clear tracking, leave closed.
      for (const jobId of Array.from(tracked)) {
        failJob(jobId, 'Connection lost. Check the History panel.')
      }
      tracked.clear()
      retries = 0
      return
    }
    retries++
    retryTimer = setTimeout(ensureOpen, 1000 * retries)
  }
}

function close(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  es?.close()
  es = null
  retries = 0
}

export function trackJob(jobId: string): void {
  if (tracked.has(jobId)) return
  tracked.add(jobId)
  ensureOpen()
}

export function untrackJob(jobId: string): void {
  if (!tracked.delete(jobId)) return
  if (tracked.size === 0) close()
}

/**
 * On app load, rediscover any jobs the server still has in flight and
 * start tracking each. Fixes the "0% progress after refresh" flash by
 * seeding the store with the server's current progress before SSE
 * delivers the next delta. Fire-and-forget — failures are non-fatal.
 */
export async function bootstrap(): Promise<void> {
  try {
    const resp = await api.getRuns(100, 0, undefined, undefined, 'processing')
    if (!resp.items.length) return

    setState((s) => {
      for (const record of resp.items as RunRecord[]) {
        if (s.run.jobs.has(record.id)) continue
        s.run.jobs.set(record.id, {
          jobId: record.id,
          effectName: record.effect_name ?? 'Playground',
          status: 'processing',
          progress: record.progress ?? 0,
          message: record.progress_msg ?? null,
          videoUrl: null,
          error: null,
        })
      }
    }, 'sse/bootstrap')

    for (const record of resp.items as RunRecord[]) {
      trackJob(record.id)
    }
  } catch (e) {
    console.warn('sseManager.bootstrap failed:', e)
  }
}

/** Test-only: reset module state so suites don't leak across runs. */
export function __resetForTests(): void {
  close()
  tracked = new Set()
}
