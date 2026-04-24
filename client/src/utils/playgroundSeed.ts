import type { EffectManifest, InputFieldSchema, ModelInfo, ModelParamEntry, RunRecord } from '@/types/api'
import type { RestoredParams } from '@/store/types'
import { parseRunInputs } from './runRecord'
import { mainParams, resolveModelParams } from './modelParams'

const ROLE_LABELS: Record<string, string> = {
  start_frame: 'Start frame',
  end_frame: 'End frame',
  reference: 'Reference image',
}

function humanizeRole(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Build a RestoredParams shape for "Try in playground" from an effect that
 * has never been run. The raw Jinja template (with `{{ placeholder }}` tags
 * intact) becomes the prompt. The manifest's `params` for the default model
 * are unwrapped to their effective values and split between output_params
 * and advanced_params based on the model's param definitions.
 */
export function effectToPlaygroundParams(
  manifest: EffectManifest,
  availableModels: ModelInfo[],
): RestoredParams {
  const modelId = manifest.generation.default_model
  const model = availableModels.find((m) => m.id === modelId)

  // Pick the effective template for this model; keep placeholders intact
  const override = manifest.generation.model_overrides?.[modelId]?.prompt
  const prompt = override || manifest.generation.prompt
  const negativePrompt = manifest.generation.negative_prompt ?? ''

  // Resolve effective params (top-level + per-model override) and unwrap
  // each entry to its scalar value, then split by output vs advanced. Effects
  // are always launched from an image input, so use the image_to_video variant
  // from the default provider (values still land in the form regardless of
  // which provider the user later picks — server filters by known keys).
  const merged = resolveModelParams(manifest, modelId)
  const defaultProvider = model?.providers?.find((p) => p.is_available) ?? model?.providers?.[0]
  const variant = defaultProvider?.variants?.image_to_video
  const outputKeys = new Set(mainParams(variant).map((p) => p.key))
  const output: Record<string, string | number> = {}
  const userParams: Record<string, unknown> = {}
  for (const [k, entry] of Object.entries(merged)) {
    const v = 'value' in entry ? entry.value : entry.default
    if (outputKeys.has(k)) output[k] = v
    else userParams[k] = v
  }

  return {
    modelId,
    inputs: { prompt, negative_prompt: negativePrompt },
    output,
    userParams,
  }
}

/**
 * Build a RestoredParams shape for "Open in playground" from an effect run.
 * Uses the server-persisted `model_inputs` — already in the normalized,
 * role-keyed, fully-resolved playground shape. No manifest dependency, so
 * this works even for orphaned effect runs.
 *
 * Only called for effect runs (the UI gates the button on record.kind === 'effect').
 */
export function runToPlaygroundParams(record: RunRecord): RestoredParams {
  const { modelInputs, output, userParams } = parseRunInputs(record)
  return {
    modelId: record.model_id,
    inputs: modelInputs,
    output,
    userParams,
  }
}

/**
 * Convert a successful playground run into a full EffectManifest object,
 * ready to be serialized to YAML and loaded into the editor for saving as
 * a new effect.
 *
 * The playground prompt is taken as-is (it's already the final string the
 * user sent; there are no placeholders to preserve). Each image role becomes
 * an `image` input field in the manifest schema. All output + advanced
 * params are merged into `generation.params` as overridable defaults.
 */
export function playgroundRunToManifest(record: RunRecord): EffectManifest {
  const parsed = parseRunInputs(record)
  // Playground runs store their normalized shape in `inputs` directly
  const source = parsed.inputs

  const prompt = String(source.prompt ?? '')
  const negativePrompt = String(source.negative_prompt ?? '')

  // Build image input schema fields from any non-prompt keys
  const inputs: Record<string, InputFieldSchema> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'prompt' || key === 'negative_prompt') continue
    if (typeof value !== 'string' || !value) continue
    // Treat remaining string values as image roles (that's the only other thing
    // the playground stores under `inputs`).
    inputs[key] = {
      type: 'image',
      role: key,
      required: true,
      label: humanizeRole(key),
    }
  }

  const mergedParams: Record<string, ModelParamEntry> = {}
  for (const [k, v] of Object.entries(parsed.output)) {
    mergedParams[k] = { default: v }
  }
  for (const [k, v] of Object.entries(parsed.userParams)) {
    if (typeof v === 'number' || typeof v === 'string') {
      mergedParams[k] = { default: v }
    } else if (typeof v === 'boolean') {
      mergedParams[k] = { default: String(v) }
    }
  }

  const shortId = record.id.slice(0, 8)

  return {
    db_id: '',
    compatible_models: [],
    is_favorite: false,
    namespace: 'my',
    id: `from-playground-${shortId}`,
    name: 'My Effect',
    description: 'Created from a playground run.',
    version: '1.0.0',
    author: 'me',
    type: 'transform',
    tags: ['custom'],
    assets: {},
    inputs,
    generation: {
      prompt,
      negative_prompt: negativePrompt,
      models: [record.model_id],
      default_model: record.model_id,
      params: mergedParams,
      model_overrides: {},
      reverse: false,
    },
    source: 'local',
  }
}

