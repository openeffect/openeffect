import type { EffectManifest } from '@/types/api'

/** Matches the manifest's `id: namespace/slug` line. Used by saveEffect
 *  to surgically patch the id when the server auto-suffixes on a slug
 *  collision, without disturbing any other lines the user may have
 *  edited while save was in flight. */
export const ID_LINE_RE = /^id:\s*(.+)$/m

export const BLANK_TEMPLATE = `manifest_version: 1

id: my/new-effect
name: New Effect
description: >
  Describe what this effect does.

version: "0.1.0"
author: me
category: transform

tags:
  - custom

showcases:
  - preview: preview.mp4
    inputs:
      image: input-image.jpg

inputs:
  image:
    type: image
    role: start_frame
    required: true
    label: "Your photo"
    hint: "Upload a photo to use"

  scene_prompt:
    type: text
    required: false
    label: "Describe the scene"
    placeholder: "A cinematic shot..."
    hint: "Briefly describe what's in the input image - extra context like subject, setting, or time of day helps the model preserve the scene more faithfully"
    max_length: 500
    multiline: false

generation:
  models:
    - kling-3.0
    - wan-2.7

  default_model: kling-3.0

  prompt: >
    Cinematic effect on the subject.
    {% if scene_prompt %}Scene description: {{ scene_prompt }}{% endif %}
    High quality, 4K resolution.

  negative_prompt: >
    low quality, blurry, watermark

  params:
    duration: 5
`

export const BLANK_MANIFEST: EffectManifest = {
  manifest_version: 1,
  id: '',
  full_id: 'my/new-effect',
  compatible_models: [],
  is_favorite: false,
  namespace: 'my',
  slug: 'new-effect',
  name: 'New Effect',
  description: 'Describe what this effect does.',
  version: '0.1.0',
  author: 'me',
  category: 'transform',
  tags: ['custom'],
  showcases: [],
  inputs: {
    image: {
      type: 'image',
      role: 'start_frame',
      required: true,
      label: 'Your photo',
      hint: 'Upload a photo to use',
    },
    scene_prompt: {
      type: 'text',
      required: false,
      label: 'Describe the scene',
      placeholder: 'A cinematic shot...',
      hint: "Briefly describe what's in the input image - extra context like subject, setting, or time of day helps the model preserve the scene more faithfully",
      max_length: 500,
      multiline: false,
    },
  },
  generation: {
    prompt: "Cinematic effect on the subject. {% if scene_prompt %}Scene description: {{ scene_prompt }}{% endif %} High quality, 4K resolution.",
    negative_prompt: 'low quality, blurry, watermark',
    models: ['kling-3.0', 'wan-2.7'],
    default_model: 'kling-3.0',
    params: { duration: { default: 5 } },
    model_overrides: {},
    reverse: false,
  },
  source: 'local',
}
