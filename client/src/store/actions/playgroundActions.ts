import { setState } from '../index'
import { mutateCloseEditor } from '../mutations/editorMutations'
import { mutateSelectEffect } from '../mutations/effectsMutations'
import {
  mutateClearViewingJob,
  mutateSetLastAppliedRunId,
  mutateSetRestoredParams,
  mutateSetViewingRunRecord,
} from '../mutations/runMutations'
import { refreshLoadedHistories } from './historyActions'
import { api } from '@/utils/api'
import { navigate } from '@/utils/router'
import type { PlaygroundRunRequest } from '@/types/api'
import type { RestoredParams } from '../types'

/** Open the playground page (clears editor/effect/run). */
export function openPlayground(skipNav?: boolean): void {
  setState((s) => {
    mutateCloseEditor(s)
    mutateSelectEffect(s, null)
    mutateClearViewingJob(s)
    s.playground.isOpen = true
  }, 'playground/open')
  if (!skipNav) {
    navigate('/playground')
  }
}

/** Close the playground (returns to gallery). */
export function closePlayground(skipNav?: boolean): void {
  setState((s) => {
    s.playground.isOpen = false
    mutateClearViewingJob(s)
  }, 'playground/close')
  if (!skipNav) {
    navigate('/')
  }
}

/**
 * Open the playground with a pre-seeded form. Used by "Try in playground"
 * (from an effect's three-dot menu) and "Open in playground" (from an effect
 * run's parameters section).
 *
 * Uses raw window.history.pushState instead of navigate() because navigate()
 * fires popstate, which would re-run the route listener, which calls
 * openPlayground() → mutateClearViewingJob() → clears restoredParams. Doing
 * state + URL updates manually in a single setState keeps restoredParams in
 * place so the PlaygroundForm can consume it on mount.
 */
export function openInPlayground(params: RestoredParams): void {
  setState((s) => {
    mutateCloseEditor(s)
    mutateSelectEffect(s, null)
    mutateClearViewingJob(s)            // clears restoredParams
    mutateSetRestoredParams(s, params)  // re-set AFTER the clear
    s.playground.isOpen = true
  }, 'playground/openInPlayground')

  if (typeof window !== 'undefined') {
    window.history.pushState(null, '', '/playground')
  }
}

/**
 * Submit a playground run. After the request returns we navigate to
 * /playground?run={jobId} so the URL identifies the active run, mirroring
 * how startRun navigates effect runs to /effects/{id}?run={jobId}.
 */
export async function startPlaygroundRun(args: {
  modelId: string
  providerId: string
  prompt: string
  negativePrompt: string
  imageInputs: Record<string, File | string>
  output: Record<string, string | number>
  userParams: Record<string, number | string | boolean>
}): Promise<string> {
  // Upload any File objects to get ref_ids; pass through existing ref_id strings
  const resolvedImageInputs: Record<string, string> = {}
  for (const [role, val] of Object.entries(args.imageInputs)) {
    if (val instanceof File) {
      const uploaded = await api.upload(val)
      resolvedImageInputs[role] = uploaded.ref_id
    } else if (typeof val === 'string' && val) {
      resolvedImageInputs[role] = val
    }
  }

  const request: PlaygroundRunRequest = {
    model_id: args.modelId,
    provider_id: args.providerId,
    prompt: args.prompt,
    negative_prompt: args.negativePrompt || undefined,
    image_inputs: Object.keys(resolvedImageInputs).length > 0 ? resolvedImageInputs : undefined,
    output: Object.keys(args.output).length > 0 ? args.output : undefined,
    user_params: Object.keys(args.userParams).length > 0 ? args.userParams : undefined,
  }

  const response = await api.playgroundRun(request)

  setState((s) => {
    s.run.jobs.set(response.job_id, {
      jobId: response.job_id,
      effectName: 'Playground',
      status: 'processing',
      progress: 0,
      message: 'Starting...',
      videoUrl: null,
      error: null,
    })
    s.run.viewingJobId = response.job_id
    s.run.leftPanel = 'progress'
    s.playground.isOpen = true
    if (response.record) mutateSetViewingRunRecord(s, response.record)
    // Mark this as the last-applied run so the Restore banner doesn't pop up
    // for the run we just submitted (the form already matches it).
    mutateSetLastAppliedRunId(s, response.job_id)
  }, 'playground/run/start')

  navigate('/playground', { run: response.job_id })
  refreshLoadedHistories()

  return response.job_id
}
