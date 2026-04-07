import type { EffectManifest, ModelParamEntry } from '@/types/api'

function effectiveValue(entry: ModelParamEntry): number | string {
  return 'value' in entry ? entry.value : entry.default
}

function isLocked(entry: ModelParamEntry): boolean {
  return 'value' in entry
}

/** Merge top-level model_params with model_overrides[modelId].model_params. */
export function resolveModelParams(
  manifest: EffectManifest,
  modelId: string,
): Record<string, ModelParamEntry> {
  const merged: Record<string, ModelParamEntry> = { ...(manifest.generation.model_params ?? {}) }
  const override = manifest.generation.model_overrides?.[modelId]?.model_params
  if (override) Object.assign(merged, override)
  return merged
}

/** Set of param keys that are locked (use `value:`) for the given model. */
export function lockedKeys(
  manifest: EffectManifest,
  modelId: string,
): Set<string> {
  const merged = resolveModelParams(manifest, modelId)
  const out = new Set<string>()
  for (const [k, entry] of Object.entries(merged)) {
    if (isLocked(entry)) out.add(k)
  }
  return out
}

/** Effective value (default or value) for a single param key, or undefined. */
export function paramDefault(
  manifest: EffectManifest,
  modelId: string,
  key: string,
): number | string | undefined {
  const merged = resolveModelParams(manifest, modelId)
  const entry = merged[key]
  return entry === undefined ? undefined : effectiveValue(entry)
}
