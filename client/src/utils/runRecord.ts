import type { RunRecord } from '@/types/api'
import type { RestoredParams } from '@/store/types'

/**
 * Parse the structured `payload` JSON stored on a RunRecord.
 *
 * Both effect and playground records use the same wrapper shape:
 *   { record_version, inputs, model_inputs?, params }
 *
 * - `inputs` is form-keyed (manifest field values) for effect runs and
 *   already-canonical (prompt + negative_prompt + role-keyed images) for
 *   playground runs.
 * - `model_inputs` is the canonical role-keyed view sent to the provider
 *   (effect runs only - playground's `inputs` is already that shape).
 * - `params` is all model variant params (main + advanced flattened), matching
 *   the shape of the model definition itself.
 */
export function parseRunInputs(record: RunRecord): {
  inputs: Record<string, string>
  modelInputs: Record<string, string>
  params: Record<string, string | number | boolean>
} {
  const raw = typeof record.payload === 'string'
    ? (JSON.parse(record.payload) as Record<string, unknown>)
    : (record.payload as Record<string, unknown> | null)

  if (raw && typeof raw === 'object' && 'inputs' in raw) {
    return {
      inputs: ((raw.inputs as Record<string, string> | undefined) ?? {}),
      modelInputs: ((raw.model_inputs as Record<string, string> | undefined) ?? {}),
      params: ((raw.params as Record<string, string | number | boolean> | undefined) ?? {}),
    }
  }

  return {
    inputs: ((raw ?? {}) as Record<string, string>),
    modelInputs: {},
    params: {},
  }
}

/** Build a `RestoredParams` object suitable for `mutateSetRestoredParams`. */
export function buildRestoredParamsFromRecord(record: RunRecord): RestoredParams {
  const { inputs, params } = parseRunInputs(record)
  return {
    modelId: record.model_id ?? '',
    inputs,
    params,
  }
}
