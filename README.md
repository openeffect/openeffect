<div align="center">

<h1>
<img src="https://raw.githubusercontent.com/openeffect/openeffect/main/docs/assets/logo.png" width="120" alt="OpenEffect logo" /><br/>
OpenEffect
</h1>

Open magic for your media - an AI video-effects tool.

[![PyPI](https://img.shields.io/pypi/v/openeffect.svg)](https://pypi.org/project/openeffect/)
[![Python](https://img.shields.io/pypi/pyversions/openeffect.svg)](https://pypi.org/project/openeffect/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/openeffect/openeffect/blob/main/LICENSE)

<img src="https://raw.githubusercontent.com/openeffect/openeffect/main/docs/assets/paparazzi-flash-input.jpg" width="24%" />
<img src="https://raw.githubusercontent.com/openeffect/openeffect/main/docs/assets/paparazzi-flash-output.gif" width="24%" />
<img src="https://raw.githubusercontent.com/openeffect/openeffect/main/docs/assets/set-on-fire-input.jpg" width="24%" />
<img src="https://raw.githubusercontent.com/openeffect/openeffect/main/docs/assets/set-on-fire-output.gif" width="24%" />

<br/>
<br/>

</div>

OpenEffect is what [Higgsfield](https://higgsfield.ai), [Pollo](https://pollo.ai), and Runway-style "click one button, get a cinematic clip" tools look like when they're **open-source, BYOK, and built around portable effect manifests you own**. Pick an effect (atmosphere, camera moves, transforms), drop in a photo, and a short video comes back. Every effect is a YAML file you can fork, tweak, share, and ship to the community catalog.

> 🚧 **Early days** - breaking changes possible until version 1.

## Quickstart

### uvx

```bash
uvx openeffect
```

No install - `uv` pulls the package into an ephemeral env and runs it.

### pip

```bash
pip install openeffect
openeffect
```

### Docker Compose

```bash
curl -O https://raw.githubusercontent.com/openeffect/openeffect/main/docker-compose.yml
docker compose up
```

---

Whichever path you pick, the browser opens at `http://localhost:3131`. Paste a [fal.ai key](https://fal.ai/dashboard/keys) into Settings (or set `FAL_KEY` as an environment variable). Then pick an effect, drag in a photo, and hit Generate.

## Why BYOK?

OpenEffect is **bring your own key** - the app runs on your machine, but generation itself happens on whichever cloud provider you point it at. Two reasons:

1. **You can't realistically self-host video models.** State-of-the-art video diffusion needs 24-80 GB of GPU memory and minutes per clip. Closed models like Kling can't be self-hosted at all. The good open ones (Wan, etc.) need a beefy GPU most people don't have at home.
2. **It's cheap to try.** fal.ai charges roughly **$0.05-$0.50 per video** depending on model and resolution. A handful of dollars buys hundreds of test runs - far less than any "AI video" subscription, with no monthly commitment and no auto-renewal.

We picked [fal.ai](https://fal.ai) as the first provider because they expose the broadest open-vs-closed model selection behind one unified API. **We're not affiliated with fal.ai** - it was just the cleanest plug-in option. More providers (Replicate, Hugging Face Inference, your own GPU server) are on the roadmap. The app's storage stays local: your fal.ai key, your run history, and your generated videos all live in `~/.openeffect/` and never touch our servers, because there are no servers.

## Build effects together

The two examples up top are seed content - a starter set of effects (atmosphere, camera moves, transforms) ships in the box, all stored as YAML manifests under [`effects/`](https://github.com/openeffect/openeffect/tree/main/effects). The point of this project isn't to ship a fixed list - it's to **grow an open library of cinematic effects, in the open**.

- **Author** an effect with the in-app editor - click `+` in the header and you get a blank manifest plus an asset uploader.
- **Export** any effect as a `.zip` archive (Effect → ⋯ → Export) - manifest, prompt, asset references, all portable.
- **Install** an effect with one click - drop a `.zip` into the Install effect dialog, or paste a URL to a remote `manifest.yaml`.
- **Share** what you make. Publish on your own GitHub and post the install URL anywhere - Discord, gists, wherever your audience is.

The long-term plan is a separate **community-catalog repo** where anyone can browse, install, and remix without ever leaving the app - coming soon. If you've made something cool in the meantime, [open an issue](https://github.com/openeffect/openeffect/issues) and we'll feature it.

## Features

- 🎬 **Curated effect library** - atmosphere, camera moves, transforms, more landing as the catalog grows
- 🧠 **Multi-model, multi-provider** - Kling, PixVerse, Wan; more models and providers landing as the catalog grows
- 🔑 **BYOK** - bring your own [fal.ai](https://fal.ai) key, pay only for what you generate
- 📁 **Local-first storage** - your runs, effects, and config live in `~/.openeffect/`
- 📜 **Run history** - every generation saved with its inputs and the resulting video
- 🧪 **Playground** mode for quick prompt experiments without authoring a manifest
- ✏️ **In-app YAML editor** for forking, customizing, and authoring new effects
- 📦 **Export / import** effects as portable `.zip` archives
- 🌗 **Light / dark / system theme**
- ⚡ **Easy to install and run** - one command via `uvx`, `pip`, or Docker Compose

## Writing your own effect

The fastest path is the in-app editor - click `+` in the header, fill in the manifest, and upload a sample preview and an input image. Effects are plain YAML - here's the full bundled [Eyes Glow](https://github.com/openeffect/openeffect/blob/main/effects/atmosphere/eyes-glow/manifest.yaml) manifest (more under [`effects/`](https://github.com/openeffect/openeffect/tree/main/effects)):

```yaml
manifest_version: 1

id: openeffect/eyes-glow
name: Eyes Glow
description: >
  A subtle luminous spark appears in the subject's eyes,
  creating a cinematic mystical look while preserving realism and identity.

version: "0.1.0"
author: OpenEffect
category: atmosphere

tags:
  - eyes
  - glow
  - mystical
  - subtle

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
    hint: "Works best with portraits or close-ups where the eyes are clearly visible"

generation:
  models:
    - kling-3.0

  default_model: kling-3.0

  prompt: >
    A single continuous shot of the same subject from the input image.
    A subtle luminous spark gradually appears in the eyes,
    creating a soft cinematic eye shimmer.
    Preserve the same identity, face, hairstyle, clothing, pose, and background.
    The glow stays localized inside the irises and pupils,
    with only a faint natural reflection nearby.
    The subject remains planted in the same scene.
    Only subtle natural micro-motion is allowed.
    No cut, no scene replacement, no duplicate subject.

  negative_prompt: >
    cut, scene replacement, duplicate subject, extra people, warped face,
    deformed anatomy, full face glow, entire body glow, random neon streaks,
    laser beams, energy explosion, fire from eyes, destructive energy,
    weapon-like glow, heavy bloom, extreme overexposure, scary horror eyes,
    smoke, blur, heavy jitter, text, watermark

  model_overrides:
    kling-3.0:
      prompt: >
        Close-up or medium close-up of the same subject from the input image.
        A soft cinematic spark slowly appears in the eyes in one continuous shot.
        The eyes gain a gentle luminous shimmer inside the irises and pupils,
        with very light reflection around the eyelids only.
        The glow should feel elegant, calm, and slightly magical,
        not scary, not aggressive, and not like light is being emitted outward.
        The same subject remains planted and recognizable throughout.
        Only slight blink, breathing, or micro-expression is allowed.
        Clean continuity, no cut, no scene replacement, no laser beams.
      params:
        duration: 4
        generate_audio: false
        guidance_scale: 0.52
```

## Configuration

- **fal.ai API key** - Settings → paste key, *or* `FAL_KEY=sk-...` env var
- **Data directory** - `~/.openeffect/` (override with `OPENEFFECT_USER_DATA_DIR`)
- **Server port** - `3131` by default (override with `OPENEFFECT_PORT`)
- **Skip browser open** - `OPENEFFECT_NO_BROWSER=true`

## Develop

```bash
git clone https://github.com/openeffect/openeffect && cd openeffect
make install
make test
make lint
make dev   # backend on :3131, Vite frontend on :5173
```

The frontend is React + TypeScript + Tailwind in `client/`. The backend is FastAPI + SQLite in `server/`. Effects YAML lives in `effects/`.

## Roadmap

The aim is to grow OpenEffect into an open, **portable effect studio** - everything Higgsfield-style products do, but local-first and BYOK.

**Near-term**
- [ ] **More effects.** Aging, weather (rain/snow), aesthetic filters, time-of-day shifts, audio-reactive params.
- [ ] **Transitions.** Between two photos - match-cuts, dissolves, morphs.
- [ ] **Motion control.** Camera-path templates, subject-locked motion, controllable speed and arc.
- [ ] **Public effect index.** Browse and one-click install community-authored effects without leaving the app.
- [ ] **More providers.** Replicate, Hugging Face Inference, custom HTTP endpoints - the fal.ai dependency goes from "the only choice" to "one of many."

**Studio direction**
- [ ] **Reference characters.** Reusable subject identities you can drop into any effect and keep consistent across runs.
- [ ] **Reference voices.** Reusable voice presets for narration, dialog, and lip-sync work.
- [ ] **Lip sync.** Drive a character's mouth from an audio clip or text.
- [ ] **Local inference.** For open models that fit on consumer hardware - if there's enough demand to justify the engineering.

Have an idea? [Open an issue](https://github.com/openeffect/openeffect/issues) - early-days roadmaps benefit most from people picking what they actually want.

## Acknowledgements

OpenEffect is glue. The heavy lifting belongs to the model authors:
- [Kling](https://kling.ai) (Kuaishou)
- [PixVerse](https://pixverse.ai)
- [Wan](https://wan.video) (Alibaba)

...and to [fal.ai](https://fal.ai) for the unified inference API. Not affiliated with any of the above - they're independent products that happen to make this one possible.

## License

MIT - see [LICENSE](https://github.com/openeffect/openeffect/blob/main/LICENSE).
