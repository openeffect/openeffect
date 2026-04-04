import { setState, getState } from '../index'
import { mutateClearViewingJob, mutateSetViewingRunRecord, mutateSetRestoredParams } from '../mutations/runMutations'
import { api } from '@/utils/api'
import { navigate } from '@/utils/router'
import type { EffectManifest, RunRequest } from '@/types/api'

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
        const uploaded = await api.upload(val)
        inputs[key] = uploaded.ref_id
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
  outputValues: Record<string, string | number>,
  advancedValues: Record<string, unknown>,
): Promise<string> {
  const inputs = await prepareInputs(manifest, values)

  const request: RunRequest = {
    effect_id: manifest.db_id,
    model_id: selectedModel || manifest.generation.default_model,
    provider_id: selectedProvider,
    inputs,
    output: outputValues,
    user_params:
      Object.keys(advancedValues).length > 0
        ? (advancedValues as Record<string, number | string>)
        : undefined,
  }

  const response = await api.run(request)

  setState((s) => {
    s.run.jobs.set(response.job_id, {
      jobId: response.job_id,
      effectName: manifest.name,
      status: 'processing',
      progress: 0,
      message: 'Starting...',
      videoUrl: null,
      error: null,
    })
    s.run.viewingJobId = response.job_id
    s.run.leftPanel = 'progress'
  }, 'run/start')

  navigate(`/effects/${manifest.db_id}`, { run: response.job_id })
  return response.job_id
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

export function completeJob(jobId: string, videoUrl: string): void {
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

  // Reload per-effect history so the new run appears at the top
  const effectId = getState().history.effectId
  if (effectId) {
    import('./historyActions').then(({ loadEffectHistory }) => loadEffectHistory(effectId))
  }
}

export function failJob(jobId: string, error: string): void {
  setState((s) => {
    const job = s.run.jobs.get(jobId)
    if (job) {
      job.status = 'failed'
      job.error = error
    }
  }, 'run/fail')
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

export async function restoreFromUrl(id: string): Promise<string | null> {
  setState((s) => {
    s.run.restoringFromUrl = true
  }, 'run/restoreStart')

  try {
    const record = await api.getRun(id)

    setState((s) => {
      mutateSetViewingRunRecord(s, record)
      s.run.restoringFromUrl = false
    }, 'run/restore')

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
