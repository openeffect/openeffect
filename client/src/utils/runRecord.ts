import type { RunRecord } from '@/types/api'
import type { RestoredParams } from '@/store/types'

/**
 * Parse the structured `inputs` JSON stored on a RunRecord into typed fields.
 *
 * Both effect and playground records use the unified wrapper shape:
 *   { inputs: ..., output: ..., user_params: ... }
 *
 * Effect runs also store `model_inputs` — the normalized, role-keyed, fully-
 * resolved shape that was sent to the provider (the template with user values
 * substituted, images re-keyed by role instead of field name). This is what
 * the "Open in playground" flow consumes, since the playground form already
 * expects that shape and the data is stable across effect deletion.
 *
 * Playground runs don't store `model_inputs` because their `inputs` is already
 * in the normalized shape — parseRunInputs returns `modelInputs: {}` for them.
 */
export function parseRunInputs(record: RunRecord): {
  inputs: Record<string, string>
  modelInputs: Record<string, string>
  output: Record<string, string | number>
  userParams: Record<string, unknown>
} {
  const raw = typeof record.inputs === 'string'
    ? (JSON.parse(record.inputs) as Record<string, unknown>)
    : (record.inputs as Record<string, unknown> | null)

  if (raw && typeof raw === 'object' && 'inputs' in raw) {
    return {
      inputs: ((raw.inputs as Record<string, string> | undefined) ?? {}),
      modelInputs: ((raw.model_inputs as Record<string, string> | undefined) ?? {}),
      output: ((raw.output as Record<string, string | number> | undefined) ?? {}),
      userParams: ((raw.user_params as Record<string, unknown> | undefined) ?? {}),
    }
  }

  return {
    inputs: ((raw ?? {}) as Record<string, string>),
    modelInputs: {},
    output: {},
    userParams: {},
  }
}

/** Build a `RestoredParams` object suitable for `mutateSetRestoredParams`. */
export function buildRestoredParamsFromRecord(record: RunRecord): RestoredParams {
  const { inputs, output, userParams } = parseRunInputs(record)
  return {
    modelId: record.model_id ?? '',
    inputs,
    output,
    userParams,
  }
}
