import { setState, getState } from '../index'
import {
  mutateClearViewingJob,
  mutateSetViewingRunRecord,
  mutateSetRestoredParams,
  mutateSetLastAppliedRunId,
} from '../mutations/runMutations'
import { mutateSetRightTab } from '../mutations/effectsMutations'
import { refreshLoadedHistories } from './historyActions'
import { trackJob } from '../sseManager'
import { api } from '@/utils/api'
import { navigate } from '@/utils/router'
import { buildRestoredParamsFromRecord } from '@/utils/runRecord'
import type { EffectManifest, RunRequest, RunRecord } from '@/types/api'

// ─── Input preparation (extracted from EffectPanel) ──────────────────────────

async function prepareInputs(
  manifest: EffectManifest,
  values: Record<string, unknown>,
): Promise<Record<string, string>> {
  const inputs: Record<string, string> = {}
  for (const [key, schema] of Object.entries(manifest.inputs ?? {})) {
    if (schema.type === 'image') {
      const val = values[key]
      if (val instanceof File) {
        const uploaded = await api.uploadFile(val)
        inputs[key] = uploaded.id
      } else if (
        val &&
        typeof val === 'object' &&
        '__restored' in (val as Record<string, unknown>)
      ) {
        inputs[key] = (val as { filename: string }).filename
      } else if (schema.required) {
        throw new Error(`Please upload ${schema.label}`)
      }
    } else {
      const val = values[key]
      if (val != null && val !== '') {
        inputs[key] = String(val)
      } else if (schema.type === 'select' && 'default' in schema) {
        inputs[key] = schema.default
      }
    }
  }
  return inputs
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function startRun(
  manifest: EffectManifest,
  values: Record<string, unknown>,
  selectedModel: string,
  selectedProvider: string,
  outputValues: Record<string, string | number | boolean>,
  advancedValues: Record<string, unknown>,
): Promise<string> {
  const inputs = await prepareInputs(manifest, values)

  // Form keeps two visual buckets (main + advanced) for rendering, but the
  // wire (and storage) shape is one flat `params` dict matching the model
  // definition. Merge here at the boundary.
  const params = { ...outputValues, ...(advancedValues as Record<string, string | number | boolean>) }

  const request: RunRequest = {
    effect_id: manifest.id,
    model_id: selectedModel || manifest.generation.default_model,
    provider_id: selectedProvider,
    inputs,
    params: Object.keys(params).length > 0 ? params : undefined,
  }

  const response = await api.run(request)

  setState((s) => {
    s.run.jobs.set(response.run_id, {
      jobId: response.run_id,
      effectName: manifest.name,
      status: 'processing',
      progress: 0,
      message: 'Starting...',
      videoUrl: null,
      error: null,
    })
    s.run.viewingJobId = response.run_id
    s.run.leftPanel = 'progress'
    // The server embeds the just-created record in the response so the
    // unified run view can render model/date/inputs/params immediately.
    if (response.record) mutateSetViewingRunRecord(s, response.record)
    // Mark this as the last-applied run so the Restore banner doesn't pop up
    // for the run we just submitted (the form already matches it).
    mutateSetLastAppliedRunId(s, response.run_id)
  }, 'run/start')

  trackJob(response.run_id)
  navigate(`/effects/${manifest.id}`, { run: response.run_id })
  refreshLoadedHistories()
  return response.run_id
}

export function updateJobProgress(jobId: string, progress: number, message: string): void {
  setState((s) => {
    const job = s.run.jobs.get(jobId)
    if (job) {
      job.progress = progress
      job.message = message
    }
  }, 'run/progress')
}

export function completeJob(jobId: string, videoUrl: string | null): void {
  setState((s) => {
    const job = s.run.jobs.get(jobId)
    if (job) {
      job.status = 'completed'
      job.progress = 100
      job.videoUrl = videoUrl
      job.message = null
    }
    if (s.run.viewingJobId === jobId) {
      s.run.leftPanel = 'run-result'
    }
  }, 'run/complete')

  refreshLoadedHistories()
}

export function failJob(jobId: string, error: string): void {
  setState((s) => {
    const job = s.run.jobs.get(jobId)
    if (job) {
      job.status = 'failed'
      job.error = error
    }
  }, 'run/fail')

  refreshLoadedHistories()
}


export function openJob(jobId: string): void {
  const job = getState().run.jobs.get(jobId)
  if (!job) return
  setState((s) => {
    s.run.viewingJobId = jobId
    s.run.leftPanel = job.status === 'completed' ? 'run-result' : 'progress'
  }, 'run/openJob')
}

export function closeJob(): void {
  const s = getState()
  if (s.editor.isOpen && s.effects.selectedId) {
    navigate(`/effects/${s.effects.selectedId}/edit`)
  } else if (s.effects.selectedId) {
    navigate(`/effects/${s.effects.selectedId}`)
  } else {
    navigate('/')
  }
  setState((s) => {
    mutateClearViewingJob(s)
  }, 'run/closeJob')
}

/**
 * Fetch a run record by id and set it as the viewing record so the result
 * shows on the left. Pass `autoApply=true` when this is part of a "fresh
 * open" navigation (the right panel was closed before, e.g. URL load or
 * clicking a run from the global history popup while on the gallery) — the
 * run's params will be loaded into the form too, since there's nothing to
 * override.
 */
export async function restoreFromUrl(id: string, autoApply = false): Promise<string | null> {
  setState((s) => {
    s.run.restoringFromUrl = true
  }, 'run/restoreStart')

  try {
    const record = await api.getRun(id)

    setState((s) => {
      mutateSetViewingRunRecord(s, record)
      s.run.restoringFromUrl = false
    }, 'run/restore')

    if (autoApply) {
      applyRunParams(record)
    }

    return record.effect_id ?? null
  } catch (e) {
    console.error('Failed to restore run from URL:', e)
    setState((s) => {
      s.run.restoringFromUrl = false
      mutateClearViewingJob(s)
    }, 'run/restoreFailed')
    navigate('/')
    return null
  }
}

export function clearRestoredParams(): void {
  setState((s) => {
    mutateSetRestoredParams(s, null)
  }, 'run/clearRestoredParams')
}

/**
 * Apply a run's params to the form: dispatches restoredParams (which forms
 * consume via a render-time prev-state check), switches the right tab to
 * Form, and marks this run as the last-applied so the Restore banner
 * hides itself.
 */
export function applyRunParams(record: RunRecord): void {
  setState((s) => {
    mutateSetRestoredParams(s, buildRestoredParamsFromRecord(record))
    mutateSetRightTab(s, 'form')
    mutateSetLastAppliedRunId(s, record.id)
  }, 'run/applyParams')
}
