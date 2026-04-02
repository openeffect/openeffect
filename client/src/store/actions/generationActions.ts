import { setState, getState } from '../index'
import {
  mutateAddJob,
  mutateUpdateJobProgress,
  mutateCompleteJob,
  mutateFailJob,
  mutateSetViewingJob,
  mutateClearViewingJob,
  mutateSetRestoredParams,
  mutateSetRestoringFromUrl,
} from '../mutations/generationMutations'
import { api } from '@/utils/api'
import { writeHash } from '@/utils/router'
import type { EffectManifest, GenerationRequest } from '@/types/api'

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

export async function startGeneration(
  manifest: EffectManifest,
  values: Record<string, unknown>,
  selectedModel: string,
  selectedProvider: string,
  outputValues: Record<string, string | number>,
  advancedValues: Record<string, unknown>,
): Promise<string> {
  const fullId = `${manifest.namespace}/${manifest.id}`
  const inputs = await prepareInputs(manifest, values)

  const request: GenerationRequest = {
    effect_id: fullId,
    model_id: selectedModel || manifest.generation.default_model,
    provider_id: selectedProvider,
    inputs,
    output: outputValues,
    user_params:
      Object.keys(advancedValues).length > 0
        ? (advancedValues as Record<string, number | string>)
        : undefined,
  }

  const response = await api.generate(request)

  setState((s) => {
    mutateAddJob(s, {
      jobId: response.job_id,
      effectName: manifest.name,
      status: 'processing',
      progress: 0,
      message: 'Starting...',
      videoUrl: null,
      error: null,
    })
    mutateSetViewingJob(s, response.job_id, 'progress')
  }, 'generation/start')

  writeHash(`generations/${response.job_id}`)
  return response.job_id
}

export function updateJobProgress(
  jobId: string,
  progress: number,
  message: string,
): void {
  setState((s) => {
    mutateUpdateJobProgress(s, jobId, progress, message)
  }, 'generation/progress')
}

export function completeJob(jobId: string, videoUrl: string): void {
  setState((s) => {
    mutateCompleteJob(s, jobId, videoUrl)
  }, 'generation/complete')
}

export function failJob(jobId: string, error: string): void {
  setState((s) => {
    mutateFailJob(s, jobId, error)
  }, 'generation/fail')
}

export function openJob(jobId: string): void {
  const job = getState().generation.jobs.get(jobId)
  if (!job) return
  setState((s) => {
    mutateSetViewingJob(s, jobId, job.status === 'completed' ? 'result' : 'progress')
  }, 'generation/openJob')
}

export function closeJob(): void {
  const s = getState()
  if (s.editor.isOpen && s.editor.editingEffectId) {
    writeHash(`effects/${s.editor.editingEffectId}/edit`)
  } else {
    writeHash(null)
  }
  setState((s) => {
    mutateClearViewingJob(s)
  }, 'generation/closeJob')
}

export async function restoreFromUrl(id: string): Promise<string | null> {
  setState((s) => {
    mutateSetRestoringFromUrl(s, true)
  }, 'generation/restoreStart')

  try {
    const record = await api.getGeneration(id)

    const manifestData = (
      typeof record.manifest_yaml === 'string'
        ? JSON.parse(record.manifest_yaml)
        : record.manifest_yaml
    ) as {
      request?: {
        effect_id?: string
        model_id?: string
        inputs?: Record<string, string>
        output?: Record<string, string | number>
        user_params?: Record<string, unknown>
      }
    } | null

    const reqData = manifestData?.request ?? null

    setState((s) => {
      mutateAddJob(s, {
        jobId: record.id,
        effectName: record.effect_name,
        status: record.status,
        progress: record.progress,
        message: record.progress_msg,
        videoUrl: record.video_url,
        error: record.error,
      })
      mutateSetViewingJob(
        s,
        record.id,
        record.status === 'completed' ? 'result' : 'progress',
      )
      mutateSetRestoredParams(
        s,
        reqData
          ? {
              modelId: reqData.model_id ?? '',
              inputs: reqData.inputs ?? {},
              output: reqData.output ?? {},
              userParams: reqData.user_params,
            }
          : null,
      )
      mutateSetRestoringFromUrl(s, false)
    }, 'generation/restore')

    return record.effect_id ?? reqData?.effect_id ?? null
  } catch (e) {
    console.error('Failed to restore generation from URL:', e)
    setState((s) => {
      mutateSetRestoringFromUrl(s, false)
      mutateClearViewingJob(s)
    }, 'generation/restoreFailed')
    writeHash(null)
    return null
  }
}

export function clearRestoredParams(): void {
  setState((s) => {
    mutateSetRestoredParams(s, null)
  }, 'generation/clearRestoredParams')
}
