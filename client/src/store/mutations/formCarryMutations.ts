import type { AppState, CarriedImage } from '../types'

/** Shared: used by EffectFormTab and PlaygroundForm to mirror image
 *  uploads into the cross-effect carry slice. */
export function mutateSetCarriedImage(s: AppState, role: string, value: CarriedImage) {
  s.formCarry.lastImagesByRole[role] = value
}

/** Shared: used by EffectFormTab and PlaygroundForm when an image cell is cleared. */
export function mutateClearCarriedImage(s: AppState, role: string) {
  delete s.formCarry.lastImagesByRole[role]
}

/** Shared: used by EffectFormTab to mirror manifest input changes (text,
 *  select, number/slider, boolean) into the carry slice. */
export function mutateSetCarriedInput(
  s: AppState,
  key: string,
  value: string | number | boolean,
) {
  s.formCarry.lastInputsByName[key] = value
}

/** Shared: used by EffectFormTab when a manifest input is cleared / emptied. */
export function mutateClearCarriedInput(s: AppState, key: string) {
  delete s.formCarry.lastInputsByName[key]
}

/** Shared: used by EffectFormTab and PlaygroundForm to mirror user-tunable
 *  model param changes (resolution, duration, aspect_ratio, …). */
export function mutateSetCarriedParam(
  s: AppState,
  key: string,
  value: string | number | boolean,
) {
  s.formCarry.lastModelParams[key] = value
}

/** Shared: used when a model param is reset to manifest/variant default. */
export function mutateClearCarriedParam(s: AppState, key: string) {
  delete s.formCarry.lastModelParams[key]
}

/** Shared: used by EffectFormTab and PlaygroundForm to remember the user's
 *  last-picked model. Consulted only when a new effect's manifest doesn't
 *  declare `default_model`. */
export function mutateSetCarriedModel(s: AppState, id: string) {
  s.formCarry.lastModelId = id
}

/** Used by PlaygroundForm to remember the prompt across navigation
 *  away and back (within a session). Effects don't read these — their
 *  prompts are manifest-driven. */
export function mutateSetCarriedPlaygroundPrompt(s: AppState, value: string) {
  s.formCarry.lastPlaygroundPrompt = value
}

export function mutateSetCarriedPlaygroundNegativePrompt(s: AppState, value: string) {
  s.formCarry.lastPlaygroundNegativePrompt = value
}
