import type { InputFieldSchema, ModelParam } from '@/types/api'

/** Returns true iff `value` is valid for the target manifest input
 *  schema. Used by `EffectFormTab` to decide whether a value carried
 *  from another effect (or held in the carry slice from a prior visit)
 *  can be applied to this input. The source effect's input type does
 *  NOT factor in - only the runtime type of the value vs the target's
 *  constraints. Image fields are handled separately by the role-keyed
 *  image carry, so this rejects them. */
export function isValidInputValue(value: unknown, schema: InputFieldSchema): boolean {
  switch (schema.type) {
    case 'image':
      return false
    case 'text':
      if (typeof value !== 'string') return false
      if (schema.max_length != null && value.length > schema.max_length) return false
      return true
    case 'select':
      return schema.options.some((o) => o.value === value)
    case 'number':
    case 'slider':
      if (typeof value !== 'number' || Number.isNaN(value)) return false
      if (schema.min != null && value < schema.min) return false
      if (schema.max != null && value > schema.max) return false
      return true
    case 'boolean':
      // The form stores booleans as 'true' / 'false' strings (run-flow
      // contract for dict[str, str] inputs); accept both shapes.
      return value === 'true' || value === 'false' || typeof value === 'boolean'
  }
}

/** Returns true iff `value` is valid for the target model param. Same
 *  intent as `isValidInputValue` but the schema shape is `ModelParam`
 *  (canonical-keyed across models). The same canonical key can carry
 *  different ranges/options across models, so a value valid for one
 *  model's variant may be rejected by another's. */
export function isValidParamValue(value: unknown, param: ModelParam): boolean {
  if (param.type === 'select' && param.options) {
    return param.options.some((o) => o.value === value)
  }
  if (param.type === 'slider' || param.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return false
    if (param.min != null && value < param.min) return false
    if (param.max != null && value > param.max) return false
    return true
  }
  if (param.type === 'boolean') return typeof value === 'boolean'
  if (param.type === 'text') return typeof value === 'string'
  return false
}
