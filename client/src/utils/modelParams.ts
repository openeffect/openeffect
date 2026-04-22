import type { EffectManifest, ModelInfo, ModelParam, ModelParamEntry, ModelVariant } from '@/types/api'

// ─── Variant params filtering ───────────────────────────────────────────────

export const imageInputs = (v: ModelVariant | undefined): ModelParam[] =>
  v ? v.params.filter((p) => p.type === 'image') : []

export const mainParams = (v: ModelVariant | undefined): ModelParam[] =>
  v ? v.params.filter((p) => p.ui === 'main') : []

export const advancedParams = (v: ModelVariant | undefined): ModelParam[] =>
  v ? v.params.filter((p) => p.ui === 'advanced') : []

/** Canonical keys of image-input params — also the semantic roles effect
 *  manifests bind to (e.g. 'start_frame', 'end_frame'). */
export const supportedImageKeys = (v: ModelVariant | undefined): string[] =>
  imageInputs(v).map((p) => p.key)

/** Look up the variant for (model, providerId, variantKey), falling back to
 *  the provider's `image_to_video` variant if the requested one isn't there. */
export const providerVariant = (
  m: ModelInfo | undefined,
  providerId: string,
  variantKey: string,
): ModelVariant | undefined => {
  const p = m?.providers.find((x) => x.id === providerId)
  return p?.variants?.[variantKey] ?? p?.variants?.image_to_video
}

/** Union of variant keys across every provider of the model. Returns
 *  `['image_to_video']` today; kept as a forward-compat seam for when
 *  additional modes (e.g. `video_to_video`) land. */
export const modelVariantKeys = (m: ModelInfo | undefined): string[] => {
  if (!m) return []
  const keys = new Set<string>()
  for (const provider of m.providers ?? []) {
    for (const k of Object.keys(provider.variants ?? {})) keys.add(k)
  }
  return Array.from(keys)
}

/** The AI-audio toggle param (canonical key `generate_audio`) if any
 *  provider-variant of the model exposes one. Callers use `.key` to write
 *  the canonical value through; the provider layer translates to wire. */
export const aiAudioSwitch = (m: ModelInfo | undefined): ModelParam | null => {
  if (!m) return null
  for (const provider of m.providers ?? []) {
    for (const v of Object.values(provider.variants ?? {})) {
      const p = v.params.find((p) => p.key === 'generate_audio')
      if (p) return p
    }
  }
  return null
}

// ─── Manifest param resolution ──────────────────────────────────────────────


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
