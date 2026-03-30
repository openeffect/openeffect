import type { EffectManifest, EffectType, InputFieldSchema } from '@/types/api'
import { SingleImageForm } from './types/SingleImageForm'
import { ImageTransitionForm } from './types/ImageTransitionForm'
import { ImageLoopForm } from './types/ImageLoopForm'
import { TextToVideoForm } from './types/TextToVideoForm'
import type { ComponentType } from 'react'

interface FormProps {
  inputs: Record<string, InputFieldSchema>
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

const FORM_COMPONENTS: Record<EffectType, ComponentType<FormProps>> = {
  single_image: SingleImageForm,
  image_transition: ImageTransitionForm,
  image_loop: ImageLoopForm,
  text_to_video: TextToVideoForm,
}

interface EffectFormRendererProps {
  manifest: EffectManifest
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

export function EffectFormRenderer({ manifest, values, onChange }: EffectFormRendererProps) {
  const FormComponent = FORM_COMPONENTS[manifest.effect_type]
  return <FormComponent inputs={manifest.inputs} values={values} onChange={onChange} />
}
