import re
from typing import Any

import jinja2

from effects.jinja_env import env
from effects.validator import EffectManifest, ModelParam
from services.model_service import get_provider


def _build_context(
    manifest: EffectManifest,
    user_inputs: dict[str, str],
) -> dict[str, str]:
    """All declared inputs seeded empty, then overlaid with the user's
    submitted values. The substituted text is whatever the form sent —
    for select fields that's the option's `value`, not its `label`.
    Authors who want human-readable phrasing in the prompt branch on
    the value with Jinja, e.g.
    `{% if mood == 'happy' %}joyful{% else %}calm{% endif %}`. Keeps
    every input type (text, number, slider, boolean, select) using
    identical substitution semantics."""
    ctx: dict[str, str] = {key: "" for key in manifest.inputs}
    for key in manifest.inputs:
        ctx[key] = user_inputs.get(key, "")
    return ctx


def _render(template_src: str, context: dict[str, str]) -> str:
    """Render through the sandboxed env and normalize whitespace. Any Jinja
    error — SyntaxError, UndefinedError, SecurityError — surfaces as a
    ValueError so the run-submission path can return a 422."""
    try:
        template = env.from_string(template_src)
        rendered = template.render(**context)
    except jinja2.exceptions.TemplateError as e:
        raise ValueError(f"Prompt template error: {e}") from e
    # Collapse runs of 2+ spaces (rendering can leave gaps where optional
    # placeholders went empty). Strip leading/trailing whitespace last.
    return re.sub(r"  +", " ", rendered).strip()


class PromptBuilder:
    @staticmethod
    def build_prompt(
        manifest: EffectManifest,
        model_id: str,
        user_inputs: dict[str, str],
    ) -> str:
        template_src = manifest.generation.prompt
        override = manifest.generation.model_overrides.get(model_id)
        if override and override.prompt:
            template_src = override.prompt
        return _render(template_src, _build_context(manifest, user_inputs))

    @staticmethod
    def build_negative_prompt(
        manifest: EffectManifest,
        model_id: str,
        user_inputs: dict[str, str],
    ) -> str:
        """Same template engine for the negative prompt. Schema doesn't yet
        allow a per-model override here (no bundled effect needed one), so we
        always render the top-level string."""
        return _render(
            manifest.generation.negative_prompt,
            _build_context(manifest, user_inputs),
        )

    @staticmethod
    def build_provider_io(
        model_id: str,
        provider_id: str,
        raw_params: dict[str, Any] | None = None,
        manifest: EffectManifest | None = None,
    ) -> dict[str, Any]:
        """Build the canonical-keyed parameters dict for a (model, provider).

        Merges the manifest's `params` with caller-supplied `raw_params`.
        Canonical keys not declared by the provider's params map are silently
        dropped — that's how provider-specific features degrade gracefully
        on providers that don't support them.

        Precedence (lowest → highest):
          1. Manifest's non-locked `params` (top-level then model override)
          2. Caller-supplied `raw_params` (user input from the form / API request)
          3. Manifest's locked `params` (always wins)
        """
        provider = get_provider(model_id, provider_id)
        if provider is None:
            return {}

        known = set(provider.get("params", {}).keys())
        result: dict[str, Any] = {}

        # Compute the effective manifest param map (top-level + model override)
        effective: dict[str, ModelParam] = {}
        if manifest is not None:
            effective = dict(manifest.generation.params)
            override = manifest.generation.model_overrides.get(model_id)
            if override and override.params:
                effective.update(override.params)

        # Pass 1: manifest defaults (non-locked) — low priority
        for key, param in effective.items():
            if key in known and not param.is_locked:
                result[key] = param.effective_value

        # Pass 2: caller-supplied request values — overrides defaults
        for key, value in (raw_params or {}).items():
            if key in known:
                result[key] = value

        # Pass 3: manifest locks — always wins
        for key, param in effective.items():
            if key in known and param.is_locked:
                result[key] = param.effective_value

        return result
